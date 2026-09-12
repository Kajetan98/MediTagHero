import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, normalize, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, READ_CTX, readCtxFor, CARRIER_KIND } from "./db.js";
import { DoctorStore } from "./doctors.js";
import { rateLimiter } from "./limit.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const TAG = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8" };

/**
 * Nagłówki na każdej odpowiedzi. CSP dopuszcza treść wstawioną w plik, bo aplikacja jest jednym
 * plikiem: styl i skrypt siedzą w `<style>` i `<script>`, a kroje i znaki w data URI. Zewnętrznych
 * źródeł nie ma żadnych, więc `'self'` i `data:` domykają listę. Formularze aplikacji obsługuje
 * skrypt, nigdy wysłanie, więc `form-action 'none'` nic nie psuje.
 */
const SAFE = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": [
    "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:", "font-src 'self' data:", "connect-src 'self'",
    "form-action 'none'", "base-uri 'none'", "frame-ancestors 'none'",
  ].join("; "),
};

/**
 * Klucz i certyfikat ze ścieżek w środowisku. Bez nich serwer zostaje na HTTP — a wtedy przeglądarka
 * nie da aplikacji ani Web NFC, ani `crypto.subtle`, bo oba wymagają bezpiecznego kontekstu.
 * Certyfikat do testów w sieci lokalnej robi `npm run cert`.
 */
export function tlsFromEnv(env = process.env) {
  const key = env.HERO_TLS_KEY, cert = env.HERO_TLS_CERT;
  if (!key || !cert) return null;
  try {
    return { key: readFileSync(key), cert: readFileSync(cert) };
  } catch (err) {
    throw new Error("Nie mogę wczytać certyfikatu TLS: " + err.message);
  }
}

const str = v => (typeof v === "string" ? v : v == null ? "" : String(v));

const send = (res, status, body, headers = {}) => {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(payload);
};
const fail = (res, status, error) => send(res, status, { error });

async function readJson(req, limit = 512 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("payload too large");
    chunks.push(chunk);
  }
  if (!size) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected an object");
  return parsed;
}

async function serveStatic(res, pathname) {
  const rel = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return fail(res, 403, "Zabroniona ścieżka");
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "content-length": body.length });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 — nie ma takiej strony");
  }
}

export function createServer(store = openDatabase(),
                             reads = rateLimiter({ limit: 30, windowMs: 60_000 }),
                             pins = rateLimiter({ limit: 10, windowMs: 15 * 60_000 }),
                             tls = tlsFromEnv()) {
  /* HSTS tylko pod TLS-em: na HTTP zablokowałby dostęp do serwera bez certyfikatu. */
  const safe = tls ? { ...SAFE, "strict-transport-security": "max-age=31536000" } : SAFE;
  const handler = async (req, res) => {
    for (const [k, v] of Object.entries(safe)) res.setHeader(k, v);
    const url = new URL(req.url, "http://localhost");
    const path = decodeURIComponent(url.pathname);

    if (!path.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Nieobsługiwana metoda");
      return serveStatic(res, path);
    }

    try {
      /* Konto zawodowe z tokenu: lekarz albo ratownik. Otwiera pełną kartę do odczytu. */
      const konto = () => store.doctors.bySession(req.headers["x-hero-doctor"]);
      /* Podpis pod wpisem bierze się wyłącznie z konta lekarza — ratownik karty nie redaguje. */
      const doctor = () => { const k = konto(); return k && k.role === "lekarz" ? k : null; };

      if (path === "/api/health") {
        return send(res, 200, { service: "hero", version: 2, cards: store.cards.count(), doctors: store.doctors.count() });
      }
      /* Tylko karty przykładowe — pełna lista jest kluczem do wszystkich odczytów ratunkowych. */
      if (path === "/api/cards" && req.method === "GET") return send(res, 200, store.cards.list(true));

      if (path === "/api/doctors" && req.method === "POST") {
        const out = store.doctors.register(await readJson(req));
        return out.error ? fail(res, out.status, out.error) : send(res, out.status, out.doctor);
      }
      if (path === "/api/doctors/session") {
        if (req.method === "POST") {
          /* Ten sam licznik co przy PIN-ie karty: hasło też da się zgadywać. */
          const key = "doctor:" + (req.socket.remoteAddress || "?");
          if (pins.blocked(key)) return fail(res, 429, "Za dużo nieudanych prób logowania");
          const out = store.doctors.login(await readJson(req));
          if (out.error) { pins.record(key); return fail(res, out.status, out.error); }
          pins.clear(key);
          return send(res, 200, { token: out.token, doctor: out.doctor });
        }
        if (req.method === "DELETE") { store.doctors.logout(req.headers["x-hero-doctor"]); return send(res, 204); }
        return fail(res, 405, "Nieobsługiwana metoda");
      }
      if (path === "/api/doctors/me" && req.method === "GET") {
        const kto = konto();
        return kto ? send(res, 200, { ...kto, sessions: store.doctors.sessions(kto.id) })
                   : fail(res, 403, "Nieznana albo wygasła sesja konta");
      }
      if (path === "/api/doctors/sessions" && req.method === "DELETE") {
        const kto = konto();
        if (!kto) return fail(res, 403, "Nieznana albo wygasła sesja konta");
        store.doctors.logoutAll(kto.id);
        return send(res, 204);
      }

      /**
       * Identyfikator nośnika → karta. Nośnik (opaska, brelok, karta do portfela) wskazuje na kartę,
       * a odczyt idzie po nim tak samo jak po adresie własnym karty. Ścieżki na PIN-ie rozwiązania
       * nie używają: skrót PIN-u wiąże się z adresem własnym karty, więc pacjent podaje ten adres.
       */
      const tagi = path.match(/^\/api\/tags\/([^/]+)$/);
      if (tagi) {
        if (req.method !== "GET") return fail(res, 405, "Nieobsługiwana metoda");
        const nosnik = tagi[1].toUpperCase();
        if (!TAG.test(nosnik)) return fail(res, 400, "Nieprawidłowy identyfikator nośnika");
        const r = store.cards.resolve(nosnik);
        if (!r) return fail(res, 404, "Ten identyfikator nie prowadzi do żadnej karty");
        const odciety = (r.carrier && r.carrier.revokedAt) || store.cards.revokedAt(r.cardId);
        /* Sam rodzaj nośnika, bez opisu nadanego przez pacjenta: opis potrafi nieść imię. */
        return send(res, 200, { tagId: r.cardId, kind: r.carrier ? r.carrier.kind : CARRIER_KIND[0],
          revoked: !!odciety, revokedAt: odciety || null });
      }

      const m = path.match(/^\/api\/cards\/([^/]+)(\/session|\/reads|\/revoke|\/pin|\/carriers(?:\/([^/]+))?)?$/);
      if (!m) return fail(res, 404, "Nieznany zasób");

      const tagId = m[1].toUpperCase();
      const sub = m[2];
      const podrzedny = m[3] ? m[3].toUpperCase() : null;
      if (!TAG.test(tagId)) return fail(res, 400, "Nieprawidłowy identyfikator opaski");

      /* Limit prób PIN-u liczony osobno dla pary adres–opaska; poprawny PIN kasuje licznik. */
      const pinKey = (req.socket.remoteAddress || "?") + " " + tagId;
      const afterPin = out => {
        if (out.status === 403) pins.record(pinKey); else pins.clear(pinKey);
        return out;
      };

      if (sub === "/session") {
        if (req.method !== "POST") return fail(res, 405, "Nieobsługiwana metoda");
        if (pins.blocked(pinKey)) return fail(res, 429, "Za dużo prób PIN-u do tej karty");
        const body = await readJson(req);
        if (!store.cards.has(tagId)) return fail(res, 404, "Nie ma karty o tym identyfikatorze");
        if (!store.cards.checkPin(tagId, body.digest)) { pins.record(pinKey); return fail(res, 403, "Nieprawidłowy PIN karty"); }
        pins.clear(pinKey);
        return send(res, 200, store.cards.fullCard(tagId));
      }

      /* Unieważnienie i przeniesienie idą na PIN-ie karty, więc obejmuje je ten sam licznik prób. */
      if (sub === "/revoke") {
        if (req.method !== "POST") return fail(res, 405, "Nieobsługiwana metoda");
        if (pins.blocked(pinKey)) return fail(res, 429, "Za dużo prób PIN-u do tej karty");
        const out = afterPin(store.cards.revoke(tagId, req.headers["x-hero-pin"]));
        return out.error ? fail(res, out.status, out.error) : send(res, 200, { revokedAt: out.revokedAt });
      }
      if (sub === "/pin") {
        if (req.method !== "POST") return fail(res, 405, "Nieobsługiwana metoda");
        if (pins.blocked(pinKey)) return fail(res, 429, "Za dużo prób PIN-u do tej karty");
        const body = await readJson(req);
        const out = afterPin(store.cards.changePin(tagId, req.headers["x-hero-pin"], body.pinHash));
        return out.error ? fail(res, out.status, out.error) : send(res, 204);
      }
      /* Nośniki tej samej karty: druga opaska, brelok, karta do portfela. Wszystko na PIN-ie karty,
         bo dodanie nośnika to wydanie kolejnego klucza do zestawu ratunkowego. */
      if (sub && sub.startsWith("/carriers")) {
        if (pins.blocked(pinKey)) return fail(res, 429, "Za dużo prób PIN-u do tej karty");
        if (!podrzedny && req.method === "POST") {
          const body = await readJson(req);
          const nowy = str(body.tagId).toUpperCase();
          if (!TAG.test(nowy)) return fail(res, 400, "Nieprawidłowy identyfikator nośnika");
          const out = afterPin(store.cards.addCarrier(tagId, req.headers["x-hero-pin"],
            { tagId: nowy, kind: body.kind, label: body.label }));
          return out.error ? fail(res, out.status, out.error) : send(res, out.status, out.carriers);
        }
        if (podrzedny && req.method === "DELETE") {
          const out = afterPin(store.cards.revokeCarrier(tagId, req.headers["x-hero-pin"], podrzedny));
          return out.error ? fail(res, out.status, out.error) : send(res, 200, out.carriers);
        }
        return fail(res, 405, "Nieobsługiwana metoda");
      }

      if (sub === "/reads") {
        if (req.method !== "POST") return fail(res, 405, "Nieobsługiwana metoda");
        /* Adres jest tym, co widzi proces; za reverse proxy trzeba go tam ograniczyć. Limit idzie
           przed sprawdzeniem unieważnienia, żeby stan opaski nie dał się wypytywać bez ograniczeń. */
        if (!reads.allow(req.socket.remoteAddress || "?")) return fail(res, 429, "Za dużo odczytów z tego adresu");
        /* Unieważniony nośnik nie ma czego pokazać, więc nie ma też czego zapisać w historii. */
        const cel = store.cards.resolve(tagId);
        if (!cel) return fail(res, 404, "Nie ma karty o tym identyfikatorze");
        const uniewazniona = (cel.carrier && cel.carrier.revokedAt) || store.cards.revokedAt(cel.cardId);
        if (uniewazniona) return send(res, 410, { error: "Nośnik unieważniony", revokedAt: uniewazniona });
        const body = await readJson(req);
        /* Dostęp zawodowy opisuje konto, nie pole z formularza — i tylko konto może go zapisać. */
        const kto = konto();
        if (!kto && READ_CTX.slice(1).includes(str(body.ctx))) {
          return fail(res, 403, "Wpis o dostępie zawodowym wymaga konta lekarza albo ratownika");
        }
        const entry = kto
          ? store.cards.addRead(cel.cardId, DoctorStore.label(kto), readCtxFor(kto.role))
          : store.cards.addRead(cel.cardId, body.by, body.ctx);
        return entry ? send(res, 201, entry) : fail(res, 404, "Nie ma karty o tym identyfikatorze");
      }

      if (req.method === "GET") {
        /**
         * Dwa poziomy odczytu. Bez konta wychodzi sam zestaw ratunkowy: to, co ratuje życie, bez
         * nazwiska, daty urodzenia i kontaktów alarmowych — bo identyfikator opaski ma każdy, kto ją
         * znalazł. Konto zawodowe (lekarz albo ratownik) dostaje kartę w całości, a jego odczyt
         * zapisuje się w historii z nazwiskiem i numerem: nie da się zajrzeć bez śladu.
         */
        const kto = konto();
        const cel = store.cards.resolve(tagId);
        if (!cel) return fail(res, 404, "Nie ma karty o tym identyfikatorze");
        const card = kto ? store.cards.fullCard(cel.cardId) : store.cards.rescueCard(cel.cardId);
        if (!card) return fail(res, 404, "Nie ma karty o tym identyfikatorze");
        /* Unieważniony nośnik i odcięta karta odpowiadają tak samo: ratownik ma wiedzieć, że trafił
           na coś odciętego, a nie na zepsuty serwis — dlatego 410, nie 404. */
        const odciety = (cel.carrier && cel.carrier.revokedAt) || card.revokedAt;
        if (odciety) return send(res, 410, { error: "Nośnik unieważniony", revokedAt: odciety });
        /* Rodzaj nośnika, którym otwarto kartę — z niego bierze się opis odczytu w historii. Opis
           nadany przez pacjenta wychodzi dopiero z kontem: potrafi nieść imię. */
        if (cel.carrier) card.carrier = kto ? cel.carrier : { tagId: cel.carrier.tagId, kind: cel.carrier.kind };
        if (kto) {
          /* Ten sam licznik co przy zapisie śladu: wgląd w karty też nie może lecieć bez końca. */
          if (!reads.allow(req.socket.remoteAddress || "?")) return fail(res, 429, "Za dużo odczytów z tego adresu");
          store.cards.addRead(cel.cardId, DoctorStore.label(kto), readCtxFor(kto.role));
          card.reads = store.cards.reads(cel.cardId);
        }
        return send(res, 200, card);
      }
      if (req.method === "PUT") {
        if (pins.blocked(pinKey)) return fail(res, 429, "Za dużo prób PIN-u do tej karty");
        const body = await readJson(req);
        const out = afterPin(store.cards.upsert(tagId, body, req.headers["x-hero-pin"] || body.pinHash, { doctor: doctor() }));
        return out.error ? fail(res, out.status, out.error) : send(res, out.status, out.card);
      }
      if (req.method === "DELETE") {
        if (pins.blocked(pinKey)) return fail(res, 429, "Za dużo prób PIN-u do tej karty");
        const out = afterPin(store.cards.remove(tagId, req.headers["x-hero-pin"]));
        return out.error ? fail(res, out.status, out.error) : send(res, 204);
      }
      return fail(res, 405, "Nieobsługiwana metoda");
    } catch (err) {
      return fail(res, 400, "Nieprawidłowe żądanie: " + err.message);
    }
  };
  const server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler);
  server.on("close", () => { try { store.close(); } catch {} });
  return server;
}

/** Adresy IPv4 tej maszyny — to je wpisuje się w telefonie, bo `localhost` wskazuje sam telefon. */
export function adresyLokalne() {
  const out = [];
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista || []) if (i.family === "IPv4" && !i.internal) out.push(i.address);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const szyfrowany = !!(process.env.HERO_TLS_KEY && process.env.HERO_TLS_CERT);
  const schemat = szyfrowany ? "https" : "http";
  const port = Number(process.env.PORT || (szyfrowany ? 8443 : 8080));
  createServer().listen(port, () => {
    console.log(`HERO działa na ${schemat}://localhost:${port}`);
    const lan = adresyLokalne();
    if (lan.length) {
      console.log("Z telefonu w tej samej sieci:");
      for (const ip of lan) console.log(`  ${schemat}://${ip}:${port}`);
    } else {
      console.log("Ten komputer nie ma adresu IPv4 w sieci lokalnej — telefon się nie połączy.");
    }
    if (!szyfrowany) {
      console.log("Bez TLS-a przeglądarka nie da zapisu opaski NFC ani skrótu PIN-u z crypto.subtle.");
      console.log("Certyfikat do testów: `npm run cert`.");
    }
  });
}
