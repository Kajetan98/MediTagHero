#!/usr/bin/env node
/**
 * Wypełnia bazę przykładową kartą i kontem lekarza, żeby po `npm start` było co odczytać
 * i czym się zalogować.
 *
 * Karta HERO-2481-KX, PIN 1234. Skrót liczony tak samo jak w przeglądarce:
 * SHA-256("hero:<tag>:<pin>"). Lekarz: PWZ 1234567, hasło meditag123 — jego podpis trafia
 * na wpisy oznaczone w karcie jako lekarskie.
 */
import { createHash } from "node:crypto";
import { openDatabase } from "./db.js";

const TAG = "HERO-2481-KX";
const digest = (tagId, pin) => createHash("sha256").update(`hero:${tagId}:${pin}`).digest("hex");
const id = n => `seed-${n}`;

const card = {
  pinHash: digest(TAG, "1234"),
  demo: true,
  updatedBy: "przykład",
  person: {
    name: "Anna Wiśniewska", birthDate: "1968-03-14", blood: "A", rh: "+", weightKg: "72", heightCm: "165", langs: "pl, en",
    devices: "Stymulator serca Medtronic, wszczepiony 2021 — nie stosować diatermii jednobiegunowej",
    note: "Trudny dostęp dożylny — preferowana prawa kończyna górna.", donor: true, dnr: false
  },
  allergies: [
    { id: id("a1"), allergen: "Penicylina", kind: "lek", reaction: "Obrzęk krtani, spadek ciśnienia", severity: 4, source: "lekarz", note: "Potwierdzone testami 2019" },
    { id: id("a2"), allergen: "Jad osy", kind: "inne", reaction: "Wstrząs anafilaktyczny", severity: 4, source: "pacjent", note: "Nosi adrenalinę w ampułko-strzykawce" },
    { id: id("a3"), allergen: "Orzechy ziemne", kind: "pokarm", reaction: "Pokrzywka, duszność", severity: 3, source: "pacjent", note: "" }
  ],
  meds: [
    { id: id("m1"), name: "Rywaroksaban", atc: "B01AF01", dose: "20 mg", freq: "1× dziennie, wieczorem", route: "doustnie", since: "2021-06", anticoag: true, source: "lekarz", note: "Migotanie przedsionków" },
    { id: id("m2"), name: "Metformina", atc: "A10BA02", dose: "1000 mg", freq: "2× dziennie", route: "doustnie", since: "2016-02", anticoag: false, source: "lekarz", note: "" },
    { id: id("m3"), name: "Lewotyroksyna", atc: "H03AA01", dose: "75 µg", freq: "rano na czczo", route: "doustnie", since: "2014-11", anticoag: false, source: "pacjent", note: "" }
  ],
  conditions: [
    { id: id("c1"), name: "Migotanie przedsionków", icd10: "I48", since: "2021", status: "aktywna", source: "lekarz", note: "Utrwalone, kontrola rytmu" },
    { id: id("c2"), name: "Cukrzyca typu 2", icd10: "E11", since: "2016", status: "kontrolowana", source: "lekarz", note: "HbA1c 6,8%" },
    { id: id("c3"), name: "Niedoczynność tarczycy", icd10: "E03", since: "2014", status: "kontrolowana", source: "pacjent", note: "" }
  ],
  contacts: [
    { id: id("k1"), name: "Marek Wiśniewski", relation: "mąż", phone: "+48 601 234 567", primary: true },
    { id: id("k2"), name: "dr Tomasz Lewandowski", relation: "lekarz prowadzący, kardiolog", phone: "+48 22 555 12 34", primary: false }
  ]
};

const DOCTOR = { pwz: "1234567", name: "dr Tomasz Lewandowski", password: "meditag123" };

const store = openDatabase();
let doctor = store.doctors.byPwz(DOCTOR.pwz);
if (!doctor) {
  const reg = store.doctors.register(DOCTOR);
  if (reg.error) { store.close(); console.error("Nie udało się założyć konta lekarza:", reg.error); process.exit(1); }
  doctor = reg.doctor;
}
/* Podpis na wpisach przykładowej karty: seed pisze poza HTTP, więc idzie z trusted. */
const podpis = { name: doctor.name, pwz: doctor.pwz, at: new Date().toISOString() };
for (const key of ["allergies", "meds", "conditions"]) {
  for (const e of card[key]) if (e.source === "lekarz") e.signedBy = podpis;
}
card.updatedBy = "lekarz";

const out = store.cards.upsert(TAG, card, card.pinHash, { trusted: true });
store.close();
if (out.error) { console.error("Nie udało się dodać karty:", out.error); process.exit(1); }
console.log(`Karta ${TAG} gotowa (PIN 1234).`);
console.log(`Konto lekarza ${DOCTOR.name}, PWZ ${DOCTOR.pwz}, hasło ${DOCTOR.password}.`);
