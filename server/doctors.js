import { randomUUID, randomBytes, createHash } from "node:crypto";
import { hashSecret, verifySecret } from "./secrets.js";

/**
 * Konta lekarzy. Konto istnieje po to, żeby wpis w karcie miał podpis: kto go
 * dodał i z jakim numerem prawa wykonywania zawodu. Podpis nadaje serwer przy
 * zapisie, nigdy przeglądarka — inaczej byłby tylko etykietą.
 *
 * Token sesji trafia do bazy jako skrót SHA-256, nie jako wartość wysyłana do przeglądarki:
 * wyciek bazy nie oddaje wtedy aktywnych sesji. Sam token ma 192 losowe bity, więc skrót bez soli
 * wystarczy — nie ma czego zgadywać ze słownika. Sesja wygasa po `SESSION_TTL_MS`.
 *
 * Numer PWZ sprawdzamy wyłącznie co do formatu: siedem cyfr. Cyfry kontrolnej
 * nie liczymy i nie odpytujemy rejestru Naczelnej Izby Lekarskiej — dopóki
 * jedno i drugie nie jest potwierdzone przy źródle, odrzucanie numerów groziłoby
 * blokowaniem prawdziwych lekarzy. Obie rzeczy są w docs/plan-rozwoju.md.
 */
export const PWZ = /^[0-9]{7}$/;
const MIN_PASSWORD = 8;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const tokenHash = token => createHash("sha256").update(String(token ?? "")).digest("hex");

export class DoctorStore {
  constructor(db, { ttlMs = SESSION_TTL_MS } = {}) {
    this.db = db;
    this.ttlMs = ttlMs;
  }

  register({ pwz, name, password }) {
    const numer = String(pwz ?? "").trim();
    const imie = String(name ?? "").trim();
    if (!PWZ.test(numer)) return { status: 400, error: "Numer PWZ składa się z siedmiu cyfr" };
    if (imie.length < 3) return { status: 400, error: "Podaj imię i nazwisko" };
    if (String(password ?? "").length < MIN_PASSWORD) return { status: 400, error: `Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków` };
    if (this.byPwz(numer)) return { status: 409, error: "Konto z tym numerem PWZ już istnieje" };

    const doctor = { id: randomUUID(), pwz: numer, name: imie, createdAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO doctors (id, pwz, name, pass, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(doctor.id, doctor.pwz, doctor.name, hashSecret(password), doctor.createdAt);
    return { status: 201, doctor };
  }

  byPwz(pwz) {
    return this.db.prepare("SELECT id, pwz, name FROM doctors WHERE pwz = ?").get(String(pwz ?? "")) ?? null;
  }

  login({ pwz, password }) {
    const row = this.db.prepare("SELECT * FROM doctors WHERE pwz = ?").get(String(pwz ?? "").trim());
    // Ten sam komunikat dla nieznanego numeru i złego hasła, żeby nie dało się
    // sprawdzać, które numery PWZ mają u nas konto.
    if (!row || !verifySecret(password, row.pass)) return { status: 403, error: "Nieprawidłowy numer PWZ albo hasło" };

    this.sweep();
    const token = randomBytes(24).toString("base64url");
    const teraz = Date.now();
    this.db.prepare("INSERT INTO doctor_sessions (token, doctor_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenHash(token), row.id, new Date(teraz).toISOString(), new Date(teraz + this.ttlMs).toISOString());
    return { status: 200, token, expiresAt: new Date(teraz + this.ttlMs).toISOString(),
      doctor: { id: row.id, pwz: row.pwz, name: row.name } };
  }

  /** Konto z tokenu sesji; sesja po terminie ważności jest kasowana zamiast honorowana. */
  bySession(token) {
    if (!token) return null;
    const skrot = tokenHash(token);
    const row = this.db.prepare(
      "SELECT s.expires_at, d.id, d.pwz, d.name FROM doctor_sessions s JOIN doctors d ON d.id = s.doctor_id WHERE s.token = ?"
    ).get(skrot);
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) {
      this.db.prepare("DELETE FROM doctor_sessions WHERE token = ?").run(skrot);
      return null;
    }
    return { id: row.id, pwz: row.pwz, name: row.name };
  }

  logout(token) {
    this.db.prepare("DELETE FROM doctor_sessions WHERE token = ?").run(tokenHash(token));
  }

  /** Sprząta sesje po terminie; wołane przy logowaniu, żeby tabela nie rosła w nieskończoność. */
  sweep() {
    this.db.prepare("DELETE FROM doctor_sessions WHERE expires_at <= ?").run(new Date().toISOString());
  }

  count() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM doctors").get().n;
  }

  /** Jak wpis podpisany przez tego lekarza opisuje się w historii odczytów. */
  static label(doctor) {
    return `${doctor.name}, PWZ ${doctor.pwz}`;
  }
}
