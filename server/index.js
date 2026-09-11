import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, normalize, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, READ_CTX } from "./db.js";
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
      const doctor = () => store.doctors.bySession(req.headers["x-hero-doctor"]);

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
        const kto = doctor();
        return kto ? send(res, 200, { ...kto, sessions: store.doctors.sessions(kto.id) })
                   : fail(res, 403, "Nieznana albo wygasła sesja lekarza");
      }
      if (path === "/api/doctors/sessions" && req.method === "DELETE") {
        const kto = doctor();
        if (!kto) return fail(res, 403, "Nieznana albo wygasła sesja lekarza");
        store.doctors.logoutAll(kto.id);
        return send(res, 204);
      }

      const m = path.match(/^\/api\/cards\/([^/]+)(\/session|\/reads|\/revoke|\/move|\/pin)?$/);
      if (!m) return fail(res, 404, "Nieznany zasób");

      const tagId = m[1].toUpperCase();
      const sub = m[2];
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
      if (sub === "/move") {
        if (req.method !== "POST") return fail(res, 405, "Nieobsługiwana metoda");
        if (pins.blocked(pinKey)) return fail(res, 429, "Za dużo prób PIN-u do tej karty");
        const body = await readJson(req);
        const nowy = str(body.tagId).toUpperCase();
        if (!TAG.test(nowy)) return fail(res, 400, "Nieprawidłowy identyfikator nowej opaski");
        const out = afterPin(store.cards.move(tagId, req.headers["x-hero-pin"], nowy, body.pinHash));
        return out.error ? fail(res, out.status, out.error) : send(res, out.status, out.card);
      }

      if (sub === "/reads") {
        if (req.method !== "POST") return fail(res, 405, "Nieobsługiwana metoda");
        /* Adres jest tym, co widzi proces; za reverse proxy trzeba go tam ograniczyć. Limit idzie
           przed sprawdzeniem unieważnienia, żeby stan opaski nie dał się wypytywać bez ograniczeń. */
        if (!reads.allow(req.socket.remoteAddress || "?")) return fail(res, 429, "Za dużo odczytów z tego adresu");
        /* Unieważniona opaska nie ma czego pokazać, więc nie ma też czego zapisać w historii. */
        const uniewazniona = store.cards.revokedAt(tagId);
        if (uniewazniona) return send(res, 410, { error: "Opaska unieważniona", revokedAt: uniewazniona });
        const body = await readJson(req);
        /* Dostęp lekarza opisuje jego konto, nie pole z formularza — i tylko konto może go zapisać. */
        const kto = doctor();
        if (body.ctx === READ_CTX[1] && !kto) return fail(res, 403, "Wpis o dostępie lekarza wymaga konta lekarza");
        const entry = kto
          ? store.cards.addRead(tagId, DoctorStore.label(kto), READ_CTX[1])
          : store.cards.addRead(tagId, body.by, body.ctx);
        return entry ? send(res, 201, entry) : fail(res, 404, "Nie ma karty o tym identyfikatorze");
      }

      if (req.method === "GET") {
        const card = store.cards.publicCard(tagId);
        if (!card) return fail(res, 404, "Nie ma karty o tym identyfikatorze");
        /* Stary adres mówi, że opaska jest odcięta. Ratownik ma wiedzieć, że trafił na unieważnioną
           opaskę, a nie na zepsuty serwis — dlatego 410, nie 404. */
        if (card.revokedAt) return send(res, 410, { error: "Opaska unieważniona", revokedAt: card.revokedAt });
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const szyfrowany = !!(process.env.HERO_TLS_KEY && process.env.HERO_TLS_CERT);
  const port = Number(process.env.PORT || (szyfrowany ? 8443 : 8080));
  createServer().listen(port, () => {
    console.log(`HERO działa na ${szyfrowany ? "https" : "http"}://localhost:${port}`);
    if (!szyfrowany) console.log("Bez TLS-a przeglądarka nie da zapisu opaski NFC — patrz `npm run cert`.");
  });
}
