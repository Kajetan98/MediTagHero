import { createServer as createHttpServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db.js";
import { DoctorStore } from "./doctors.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const TAG = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8" };

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

export function createServer(store = openDatabase()) {
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = decodeURIComponent(url.pathname);

    if (!path.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Nieobsługiwana metoda");
      return serveStatic(res, path);
    }

    try {
      const doctor = () => store.doctors.bySession(req.headers["x-hero-doctor"]);

      if (path === "/api/health") {
        return send(res, 200, { service: "hero", version: 2, cards: store.cards.list().length, doctors: store.doctors.count() });
      }
      if (path === "/api/cards" && req.method === "GET") return send(res, 200, store.cards.list());

      if (path === "/api/doctors" && req.method === "POST") {
        const out = store.doctors.register(await readJson(req));
        return out.error ? fail(res, out.status, out.error) : send(res, out.status, out.doctor);
      }
      if (path === "/api/doctors/session") {
        if (req.method === "POST") {
          const out = store.doctors.login(await readJson(req));
          return out.error ? fail(res, out.status, out.error) : send(res, 200, { token: out.token, doctor: out.doctor });
        }
        if (req.method === "DELETE") {
          store.doctors.logout(req.headers["x-hero-doctor"]);
          return send(res, 204);
        }
        return fail(res, 405, "Nieobsługiwana metoda");
      }
      if (path === "/api/doctors/me" && req.method === "GET") {
        const kto = doctor();
        return kto ? send(res, 200, kto) : fail(res, 403, "Nieznana albo wygasła sesja lekarza");
      }

      const m = path.match(/^\/api\/cards\/([^/]+)(\/session|\/reads)?$/);
      if (!m) return fail(res, 404, "Nieznany zasób");

      const tagId = m[1].toUpperCase();
      const sub = m[2];
      if (!TAG.test(tagId)) return fail(res, 400, "Nieprawidłowy identyfikator opaski");

      if (sub === "/session") {
        if (req.method !== "POST") return fail(res, 405, "Nieobsługiwana metoda");
        const body = await readJson(req);
        if (!store.cards.has(tagId)) return fail(res, 404, "Nie ma karty o tym identyfikatorze");
        if (!store.cards.checkPin(tagId, body.digest)) return fail(res, 403, "Nieprawidłowy PIN karty");
        return send(res, 200, store.cards.fullCard(tagId));
      }

      if (sub === "/reads") {
        if (req.method !== "POST") return fail(res, 405, "Nieobsługiwana metoda");
        const body = await readJson(req);
        // Lekarza opisuje jego konto, nie pole z formularza; ratownik podaje opis czytnika.
        const kto = doctor();
        const entry = kto
          ? store.cards.addRead(tagId, DoctorStore.label(kto), "dostęp lekarza")
          : store.cards.addRead(tagId, body.by, body.ctx);
        return entry ? send(res, 201, entry) : fail(res, 404, "Nie ma karty o tym identyfikatorze");
      }

      if (req.method === "GET") {
        const card = store.cards.publicCard(tagId);
        return card ? send(res, 200, card) : fail(res, 404, "Nie ma karty o tym identyfikatorze");
      }
      if (req.method === "PUT") {
        const body = await readJson(req);
        const out = store.cards.upsert(tagId, body, req.headers["x-hero-pin"] || body.pinHash, doctor());
        return out.error ? fail(res, out.status, out.error) : send(res, out.status, out.card);
      }
      if (req.method === "DELETE") {
        const out = store.cards.remove(tagId, req.headers["x-hero-pin"]);
        return out.error ? fail(res, out.status, out.error) : send(res, 204);
      }
      return fail(res, 405, "Nieobsługiwana metoda");
    } catch (err) {
      return fail(res, 400, "Nieprawidłowe żądanie: " + err.message);
    }
  });
  server.on("close", () => { try { store.close(); } catch {} });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 8080);
  createServer().listen(port, () => console.log("HERO działa na http://localhost:" + port));
}
