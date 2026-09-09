import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hashPin, verifyPin } from "./pin.js";

const SECTIONS = ["allergies", "meds", "conditions", "contacts"];
const READ_LIMIT = 200;

export function openDatabase(file = process.env.HERO_DB || "data/hero.sqlite") {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      tag_id     TEXT PRIMARY KEY,
      name       TEXT NOT NULL DEFAULT '',
      pin        TEXT NOT NULL DEFAULT '',
      data       TEXT NOT NULL,
      demo       INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT 'pacjent'
    );
    CREATE TABLE IF NOT EXISTS reads (
      id     TEXT PRIMARY KEY,
      tag_id TEXT NOT NULL REFERENCES cards(tag_id) ON DELETE CASCADE,
      at     TEXT NOT NULL,
      "by"   TEXT NOT NULL,
      ctx    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reads_by_tag ON reads(tag_id, at DESC);
  `);
  return new CardStore(db);
}

const str = v => (typeof v === "string" ? v : v == null ? "" : String(v));
const arr = v => (Array.isArray(v) ? v : []);

class CardStore {
  constructor(db) { this.db = db; }
  close() { this.db.close(); }

  /** Zestaw jawny: dokładnie to, co ratownik widzi po zbliżeniu opaski. */
  publicCard(tagId) {
    const row = this.db.prepare("SELECT * FROM cards WHERE tag_id = ?").get(tagId);
    if (!row) return null;
    return { tagId: row.tag_id, demo: !!row.demo, updatedAt: row.updated_at, updatedBy: row.updated_by, ...JSON.parse(row.data) };
  }

  /** Pełna karta wraz z historią odczytów — tylko po weryfikacji PIN-u. */
  fullCard(tagId) {
    const card = this.publicCard(tagId);
    if (!card) return null;
    card.reads = this.reads(tagId);
    return card;
  }

  list() {
    return this.db.prepare("SELECT tag_id, name, demo, updated_at FROM cards ORDER BY updated_at DESC").all()
      .map(r => ({ tagId: r.tag_id, name: r.name, demo: !!r.demo, updatedAt: r.updated_at }));
  }

  has(tagId) { return !!this.db.prepare("SELECT 1 FROM cards WHERE tag_id = ?").get(tagId); }

  checkPin(tagId, digest) {
    const row = this.db.prepare("SELECT pin FROM cards WHERE tag_id = ?").get(tagId);
    if (!row) return false;
    return verifyPin(digest, row.pin);
  }

  /** Tworzy kartę (wymaga pinHash w treści) albo aktualizuje istniejącą. */
  upsert(tagId, body, digest) {
    const exists = this.has(tagId);
    if (exists && !this.checkPin(tagId, digest)) return { status: 403, error: "Nieprawidłowy PIN karty" };
    if (!exists && !body.pinHash) return { status: 400, error: "Nowa karta wymaga pola pinHash" };

    const person = body.person && typeof body.person === "object" ? body.person : {};
    const data = { person, ...Object.fromEntries(SECTIONS.map(k => [k, arr(body[k])])) };
    const payload = JSON.stringify(data);
    if (payload.length > 256 * 1024) return { status: 413, error: "Karta przekracza 256 kB" };

    const now = new Date().toISOString();
    const updatedBy = str(body.updatedBy) || "pacjent";
    if (exists) {
      this.db.prepare("UPDATE cards SET name = ?, data = ?, updated_at = ?, updated_by = ? WHERE tag_id = ?")
        .run(str(person.name), payload, now, updatedBy, tagId);
    } else {
      this.db.prepare("INSERT INTO cards (tag_id, name, pin, data, demo, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(tagId, str(person.name), hashPin(body.pinHash), payload, body.demo ? 1 : 0, now, updatedBy);
    }
    return { status: exists ? 200 : 201, card: this.fullCard(tagId) };
  }

  remove(tagId, digest) {
    if (!this.has(tagId)) return { status: 404, error: "Nie ma karty o tym identyfikatorze" };
    if (!this.checkPin(tagId, digest)) return { status: 403, error: "Nieprawidłowy PIN karty" };
    this.db.prepare("DELETE FROM reads WHERE tag_id = ?").run(tagId);
    this.db.prepare("DELETE FROM cards WHERE tag_id = ?").run(tagId);
    return { status: 204 };
  }

  /** Ślad odczytu. Czas i identyfikator nadaje serwer, nie klient. */
  addRead(tagId, by, ctx) {
    if (!this.has(tagId)) return null;
    const entry = { id: randomUUID(), at: new Date().toISOString(), by: str(by).slice(0, 120) || "nieznany czytnik", ctx: str(ctx).slice(0, 120) || "odczyt ratunkowy" };
    this.db.prepare('INSERT INTO reads (id, tag_id, at, "by", ctx) VALUES (?, ?, ?, ?, ?)').run(entry.id, tagId, entry.at, entry.by, entry.ctx);
    return entry;
  }

  reads(tagId) {
    return this.db.prepare('SELECT id, at, "by", ctx FROM reads WHERE tag_id = ? ORDER BY at DESC LIMIT ?').all(tagId, READ_LIMIT)
      .map(r => ({ id: r.id, at: r.at, by: r.by, ctx: r.ctx }));
  }
}
