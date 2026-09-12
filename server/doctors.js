import { randomUUID, randomBytes } from "node:crypto";
import { hashSecret, verifySecret } from "./secrets.js";

/**
 * Konta zawodowe: lekarze i ratownicy medyczni. Konto robi dwie rzeczy. Podpisuje wpis w karcie —
 * kto go dodał i z jakim numerem — a od czasu rozdzielenia odczytu otwiera też pełną kartę, bo bez
 * konta serwer oddaje sam zestaw ratunkowy. Podpis nadaje serwer przy zapisie, nigdy przeglądarka.
 *
 * Numerów nie weryfikujemy: PWZ sprawdzamy co do formatu (siedem cyfr), numer ratownika co do
 * długości i znaków. Cyfry kontrolnej nie liczymy i nie odpytujemy ani rejestru Naczelnej Izby
 * Lekarskiej, ani Krajowego Rejestru Ratowników Medycznych — dopóki jedno i drugie nie jest
 * potwierdzone przy źródle, odrzucanie numerów groziłoby blokowaniem prawdziwych ratowników
 * i lekarzy. Konto nie jest więc dowodem uprawnień, tylko tożsamością, która zostaje w historii.
 * Weryfikacja przy źródle jest w docs/plan-rozwoju.md.
 */
export const PWZ = /^[0-9]{7}$/;
/** Numer w rejestrze ratowników medycznych: bez ustalonego formatu, więc tylko długość i znaki. */
export const NR_RATOWNIKA = /^[A-Za-z0-9/-]{4,20}$/;
export const ROLE = ["lekarz", "ratownik"];
const MIN_PASSWORD = 8;
/**
 * Ile godzin żyje token sesji. Konto lekarza otwiera cudzą kartę medyczną, a token leży
 * w przeglądarce na cudzym sprzęcie — bez terminu ważności zostawałby tam do końca świata.
 * Doba to kompromis: dyżur mieści się w całości, a zapomniane zalogowanie wygasa do następnego.
 */
const SESSION_HOURS = 24;
const wygasle = () => new Date(Date.now() - SESSION_HOURS * 3600_000).toISOString();

export class DoctorStore {
  constructor(db) { this.db = db; }

  register({ pwz, name, password, role }) {
    const numer = String(pwz ?? "").trim();
    const imie = String(name ?? "").trim();
    const rola = ROLE.includes(String(role ?? "")) ? String(role) : ROLE[0];
    if (rola === "lekarz" && !PWZ.test(numer)) return { status: 400, error: "Numer PWZ składa się z siedmiu cyfr" };
    if (rola === "ratownik" && !NR_RATOWNIKA.test(numer)) return { status: 400, error: "Numer ratownika ma od 4 do 20 znaków" };
    if (imie.length < 3) return { status: 400, error: "Podaj imię i nazwisko" };
    if (String(password ?? "").length < MIN_PASSWORD) return { status: 400, error: `Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków` };
    /* Numery obu zawodów leżą w jednej kolumnie, więc ten sam numer nie powtórzy się między rolami. */
    if (this.byPwz(numer)) return { status: 409, error: "Konto z tym numerem już istnieje" };

    const doctor = { id: randomUUID(), pwz: numer, name: imie, role: rola, createdAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO doctors (id, pwz, name, pass, created_at, role) VALUES (?, ?, ?, ?, ?, ?)")
      .run(doctor.id, doctor.pwz, doctor.name, hashSecret(password), doctor.createdAt, doctor.role);
    return { status: 201, doctor };
  }

  byPwz(pwz) {
    return this.db.prepare("SELECT id, pwz, name, role FROM doctors WHERE pwz = ?").get(String(pwz ?? "")) ?? null;
  }

  login({ pwz, password }) {
    const row = this.db.prepare("SELECT * FROM doctors WHERE pwz = ?").get(String(pwz ?? "").trim());
    // Ten sam komunikat dla nieznanego numeru i złego hasła, żeby nie dało się
    // sprawdzać, które numery PWZ mają u nas konto.
    if (!row || !verifySecret(password, row.pass)) return { status: 403, error: "Nieprawidłowy numer PWZ albo hasło" };

    /* Przy okazji logowania sprzątamy to, co i tak już nie działa. */
    this.db.prepare("DELETE FROM doctor_sessions WHERE created_at <= ?").run(wygasle());
    const token = randomBytes(24).toString("base64url");
    this.db.prepare("INSERT INTO doctor_sessions (token, doctor_id, created_at) VALUES (?, ?, ?)")
      .run(token, row.id, new Date().toISOString());
    return { status: 200, token, doctor: { id: row.id, pwz: row.pwz, name: row.name, role: row.role || ROLE[0] } };
  }

  /** Konto z tokenu. Token starszy niż `SESSION_HOURS` nie jest już niczyim kontem i znika. */
  bySession(token) {
    if (!token) return null;
    const klucz = String(token);
    const row = this.db.prepare(
      "SELECT d.id, d.pwz, d.name, d.role, s.created_at AS at FROM doctor_sessions s JOIN doctors d ON d.id = s.doctor_id WHERE s.token = ?"
    ).get(klucz);
    if (!row) return null;
    if (row.at <= wygasle()) {
      this.db.prepare("DELETE FROM doctor_sessions WHERE token = ?").run(klucz);
      return null;
    }
    return { id: row.id, pwz: row.pwz, name: row.name, role: row.role || ROLE[0] };
  }

  logout(token) {
    this.db.prepare("DELETE FROM doctor_sessions WHERE token = ?").run(String(token ?? ""));
  }

  /** Wylogowanie ze wszystkich urządzeń: po zgubieniu telefonu jeden token to za mało. */
  logoutAll(doctorId) {
    this.db.prepare("DELETE FROM doctor_sessions WHERE doctor_id = ?").run(String(doctorId ?? ""));
  }

  /** Ile sesji ma to konto — tyle urządzeń jest zalogowanych. */
  sessions(doctorId) {
    return this.db.prepare("SELECT COUNT(*) AS n FROM doctor_sessions WHERE doctor_id = ? AND created_at > ?")
      .get(String(doctorId ?? ""), wygasle()).n;
  }

  count() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM doctors").get().n;
  }

  /** Jak konto opisuje się w podpisie wpisu i w historii odczytów. */
  static label(doctor) {
    return doctor.role === "ratownik"
      ? `${doctor.name}, ratownik medyczny nr ${doctor.pwz}`
      : `${doctor.name}, PWZ ${doctor.pwz}`;
  }
}
