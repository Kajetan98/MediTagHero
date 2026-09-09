import { createServer as createHttpServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, READ_CTX } from "./db.js";
import { rateLimiter } from "./limit.js";

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

export function createServer(store = openDatabase(),
                             reads = rateLimiter({ limit: 30, windowMs: 60_000 }),
                             pins = rateLimiter({ limit: 10, windowMs: 15 * 60_000 })) {
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = decodeURIComponent(url.pathname);

    if (!path.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Nieobsługiwana metoda");
      return serveStatic(res, path);
    }

    try {
      if (path === "/api/health") return send(res, 200, { service: "hero", version: 1, cards: store.count() });
      /* Tylko karty przykładowe — pełna lista jest kluczem do wszystkich odczytów ratunkowych. */
      if (path === "/api/cards" && req.method === "GET") return send(res, 200, store.list(true));

      const m = path.match(/^\/api\/cards\/([^/]+)(\/session|\/reads)?$/);
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
        if (!store.has(tagId)) return fail(res, 404, "Nie ma karty o tym identyfikatorze");
        if (!store.checkPin(tagId, body.digest)) { pins.record(pinKey); return fail(res, 403, "Nieprawidłowy PIN karty"); }
        pins.clear(pinKey);
        return send(res, 200, store.fullCard(tagId));
      }

      if (sub === "/reads") {
        if (req.method !== "POST") return fail(res, 405, "Nieobsługiwana metoda");
        /* Adres jest tym, co widzi proces; za reverse proxy trzeba go tam ograniczyć. */
        if (!reads.allow(req.socket.remoteAddress || "?")) return fail(res, 429, "Za dużo odczytów z tego adresu");
        const body = await readJson(req);
        /* Dostęp lekarza to wpis o innym ciężarze niż odczyt ratunkowy, więc wymaga PIN-u karty. */
        if (body.ctx === READ_CTX[1] && !store.checkPin(tagId, req.headers["x-hero-pin"]))
          return fail(res, 403, "Wpis o dostępie lekarza wymaga PIN-u karty");
        const entry = store.addRead(tagId, body.by, body.ctx);
        return entry ? send(res, 201, entry) : fail(res, 404, "Nie ma karty o tym identyfikatorze");
      }

      if (req.method === "GET") {
        const card = store.publicCard(tagId);
        return card ? send(res, 200, card) : fail(res, 404, "Nie ma karty o tym identyfikatorze");
      }
      if (req.method === "PUT") {
        if (pins.blocked(pinKey)) return fail(res, 429, "Za dużo prób PIN-u do tej karty");
        const body = await readJson(req);
        const out = afterPin(store.upsert(tagId, body, req.headers["x-hero-pin"] || body.pinHash));
        return out.error ? fail(res, out.status, out.error) : send(res, out.status, out.card);
      }
      if (req.method === "DELETE") {
        if (pins.blocked(pinKey)) return fail(res, 429, "Za dużo prób PIN-u do tej karty");
        const out = afterPin(store.remove(tagId, req.headers["x-hero-pin"]));
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
