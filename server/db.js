import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hashSecret, verifySecret } from "./secrets.js";
import { DoctorStore } from "./doctors.js";

const SECTIONS = ["allergies", "meds", "conditions", "contacts"];
const READ_LIMIT = 200;
export const READ_CTX = ["odczyt ratunkowy", "dostęp lekarza"];

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
    CREATE TABLE IF NOT EXISTS doctors (
      id         TEXT PRIMARY KEY,
      pwz        TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      pass       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS doctor_sessions (
      token      TEXT PRIMARY KEY,
      doctor_id  TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
  `);
  return {
    cards: new CardStore(db),
    doctors: new DoctorStore(db),
    close() { db.close(); },
  };
}

const str = v => (typeof v === "string" ? v : v == null ? "" : String(v));
const arr = v => (Array.isArray(v) ? v : []);

/** Porównanie treści wpisu niezależne od kolejności kluczy w JSON-ie. */
const canon = v => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]));
  return v;
};
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

class CardStore {
  constructor(db) { this.db = db; }

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

  /**
   * Lista kart nie wychodzi na zewnątrz: identyfikator opaski jest jedynym kluczem do odczytu
   * ratunkowego, więc jej wydanie znosiłoby ochronę wynikającą z długiego identyfikatora.
   * `demoOnly` zawęża wynik do kart przykładowych i tylko taką listę oddaje API.
   */
  list(demoOnly = false) {
    const where = demoOnly ? "WHERE demo = 1 " : "";
    return this.db.prepare(`SELECT tag_id, name, demo, updated_at FROM cards ${where}ORDER BY updated_at DESC`).all()
      .map(r => ({ tagId: r.tag_id, name: r.name, demo: !!r.demo, updatedAt: r.updated_at }));
  }

  count() { return this.db.prepare("SELECT COUNT(*) AS n FROM cards").get().n; }

  has(tagId) { return !!this.db.prepare("SELECT 1 FROM cards WHERE tag_id = ?").get(tagId); }

  checkPin(tagId, digest) {
    const row = this.db.prepare("SELECT pin FROM cards WHERE tag_id = ?").get(tagId);
    if (!row) return false;
    return verifySecret(digest, row.pin);
  }

  /**
   * Podpisu „lekarz" nie nadaje klient — nadaje go serwer z konta, którym uwierzytelniono zapis.
   * Wpis zachowuje podpis, który już ma, tylko gdy identyczny wpis o tym samym `id` leżał z nim
   * w bazie: podpis dotyczy treści, więc jej zmiana go unieważnia. Wpis nowy albo zmieniony dostaje
   * podpis konta, którym idzie zapis, a bez konta schodzi do „pacjent" i traci `signedBy`.
   */
  #signEntries(section, incoming, prev, doctor, now) {
    const before = new Map(arr(prev && prev[section]).map(e => [str(e && e.id), e]));
    const podpis = doctor ? { name: doctor.name, pwz: doctor.pwz, at: now } : null;

    return incoming.map(entry => {
      if (!entry || typeof entry !== "object") return entry;
      const old = before.get(str(entry.id));
      if (old && old.source === "lekarz" && same(old, entry)) return entry;
      if (podpis && entry.source === "lekarz") return { ...entry, source: "lekarz", signedBy: podpis };
      if (entry.source === "lekarz" || entry.signedBy) {
        const { signedBy, ...reszta } = entry;
        return { ...reszta, source: "pacjent" };
      }
      return entry;
    });
  }

  /**
   * Tworzy kartę (wymaga pinHash w treści) albo aktualizuje istniejącą.
   * `trusted` omija odsiewanie podpisów i pozwala oznaczyć kartę jako przykładową; jest dla zapisu
   * spoza HTTP (seed) — serwer go nie ustawia, więc żądanie nie założy karty widocznej na liście.
   * `doctor` to konto uwierzytelnione tokenem sesji: od niego zależy podpis nowych wpisów.
   */
  upsert(tagId, body, digest, { trusted = false, doctor = null } = {}) {
    const exists = this.has(tagId);
    if (exists && !this.checkPin(tagId, digest)) return { status: 403, error: "Nieprawidłowy PIN karty" };
    if (!exists && !body.pinHash) return { status: 400, error: "Nowa karta wymaga pola pinHash" };

    const person = body.person && typeof body.person === "object" ? body.person : {};
    const prev = exists ? this.publicCard(tagId) : null;
    const now = new Date().toISOString();
    const data = { person, ...Object.fromEntries(SECTIONS.map(k =>
      [k, trusted ? arr(body[k]) : this.#signEntries(k, arr(body[k]), prev, doctor, now)])) };
    const payload = JSON.stringify(data);
    if (payload.length > 256 * 1024) return { status: 413, error: "Karta przekracza 256 kB" };

    const updatedBy = trusted ? str(body.updatedBy) || "pacjent" : (doctor ? "lekarz" : "pacjent");
    if (exists) {
      this.db.prepare("UPDATE cards SET name = ?, data = ?, updated_at = ?, updated_by = ? WHERE tag_id = ?")
        .run(str(person.name), payload, now, updatedBy, tagId);
    } else {
      this.db.prepare("INSERT INTO cards (tag_id, name, pin, data, demo, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(tagId, str(person.name), hashSecret(body.pinHash), payload, trusted && body.demo ? 1 : 0, now, updatedBy);
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

  /**
   * Ślad odczytu. Czas, identyfikator i kontekst nadaje serwer: `ctx` spoza `READ_CTX` schodzi
   * do odczytu ratunkowego, a historia starsza niż ostatnie `READ_LIMIT` wpisów jest kasowana,
   * żeby zalewanie karty odczytami nie rosło w nieskończoność. Opis czytnika (`by`) pozostaje
   * deklaracją klienta — potwierdzi go dopiero uwierzytelnienie czytnika.
   */
  addRead(tagId, by, ctx) {
    if (!this.has(tagId)) return null;
    const entry = { id: randomUUID(), at: new Date().toISOString(), by: str(by).slice(0, 120) || "nieznany czytnik",
      ctx: READ_CTX.includes(str(ctx)) ? str(ctx) : READ_CTX[0] };
    this.db.prepare('INSERT INTO reads (id, tag_id, at, "by", ctx) VALUES (?, ?, ?, ?, ?)').run(entry.id, tagId, entry.at, entry.by, entry.ctx);
    this.db.prepare('DELETE FROM reads WHERE tag_id = ? AND id NOT IN (SELECT id FROM reads WHERE tag_id = ? ORDER BY at DESC LIMIT ?)')
      .run(tagId, tagId, READ_LIMIT);
    return entry;
  }

  reads(tagId) {
    return this.db.prepare('SELECT id, at, "by", ctx FROM reads WHERE tag_id = ? ORDER BY at DESC LIMIT ?').all(tagId, READ_LIMIT)
      .map(r => ({ id: r.id, at: r.at, by: r.by, ctx: r.ctx }));
  }
}
