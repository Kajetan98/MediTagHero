import { randomUUID, randomBytes } from "node:crypto";
import { hashSecret, verifySecret } from "./secrets.js";

/**
 * Konta lekarzy. Konto istnieje po to, żeby wpis w karcie miał podpis: kto go
 * dodał i z jakim numerem prawa wykonywania zawodu. Podpis nadaje serwer przy
 * zapisie, nigdy przeglądarka — inaczej byłby tylko etykietą.
 *
 * Numer PWZ sprawdzamy wyłącznie co do formatu: siedem cyfr. Cyfry kontrolnej
 * nie liczymy i nie odpytujemy rejestru Naczelnej Izby Lekarskiej — dopóki
 * jedno i drugie nie jest potwierdzone przy źródle, odrzucanie numerów groziłoby
 * blokowaniem prawdziwych lekarzy. Obie rzeczy są w docs/plan-rozwoju.md.
 */
export const PWZ = /^[0-9]{7}$/;
const MIN_PASSWORD = 8;

export class DoctorStore {
  constructor(db) { this.db = db; }

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

    const token = randomBytes(24).toString("base64url");
    this.db.prepare("INSERT INTO doctor_sessions (token, doctor_id, created_at) VALUES (?, ?, ?)")
      .run(token, row.id, new Date().toISOString());
    return { status: 200, token, doctor: { id: row.id, pwz: row.pwz, name: row.name } };
  }

  /** Sesje nie wygasają — do domknięcia razem z resztą uwierzytelniania. */
  bySession(token) {
    if (!token) return null;
    return this.db.prepare(
      "SELECT d.id, d.pwz, d.name FROM doctor_sessions s JOIN doctors d ON d.id = s.doctor_id WHERE s.token = ?"
    ).get(String(token)) ?? null;
  }

  logout(token) {
    this.db.prepare("DELETE FROM doctor_sessions WHERE token = ?").run(String(token ?? ""));
  }

  count() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM doctors").get().n;
  }

  /** Jak wpis podpisany przez tego lekarza opisuje się w historii odczytów. */
  static label(doctor) {
    return `${doctor.name}, PWZ ${doctor.pwz}`;
  }
}
