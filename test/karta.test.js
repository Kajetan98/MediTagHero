import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

/**
 * Zawartość odczytu ratunkowego. To jedyne miejsce, które decyduje, co ratownik zobaczy na miejscu
 * zdarzenia i w jakiej kolejności — dlatego jest wycięte z web/app.html jako osobny blok i sprawdzane
 * bez przeglądarki. Serwer tego nie filtruje: `GET /api/cards/:tag` oddaje kartę w całości.
 */
const src = readFileSync(new URL("../web/app.html", import.meta.url), "utf8");
const blok = src.match(/\/\* KARTA:START[\s\S]*?\/\* KARTA:END \*\//);
assert.ok(blok, "w web/app.html nie ma bloku KARTA:START … KARTA:END");
const { critical, roAllergies, roMeds, roFlags, handoverText } = runInNewContext(
  "(function(){" + blok[0] + "\nreturn {critical, roAllergies, roMeds, roFlags, handoverText};})()");

const karta = () => ({
  tagId: "HERO-2481-KX",
  person: { name: "Anna Wiśniewska", birthDate: "1968-03-14", blood: "A", rh: "+",
    devices: "Stymulator serca Medtronic", dnr: false, donor: true },
  allergies: [
    { id: "a1", allergen: "Orzechy ziemne", severity: 3 },
    { id: "a2", allergen: "Pyłki traw", severity: 1 },
    { id: "a3", allergen: "Penicylina", severity: 4, reaction: "Obrzęk krtani" },
  ],
  meds: [
    { id: "m1", name: "Metformina", dose: "1000 mg" },
    { id: "m2", name: "Rywaroksaban", dose: "20 mg", anticoag: true },
    { id: "m3", name: "Lewotyroksyna", dose: "75 µg" },
  ],
  conditions: [
    { id: "c1", name: "Migotanie przedsionków", icd10: "I48", status: "aktywna" },
    { id: "c2", name: "Zapalenie płuc", icd10: "J18", status: "przebyta" },
    { id: "c3", name: "Cukrzyca typu 2", icd10: "E11", status: "kontrolowana" },
  ],
  contacts: [
    { id: "k1", name: "Biuro", relation: "praca", phone: "+48 22 000 00 00" },
    { id: "k2", name: "Marek Wiśniewski", relation: "mąż", phone: "+48 601 234 567", primary: true },
  ],
  reads: [{ id: "r1", at: "2026-09-09T08:13:11.000Z", by: "ZRM S-04", ctx: "odczyt ratunkowy" }],
  updatedAt: "2026-09-09T08:12:44.000Z", updatedBy: "lekarz",
});

test("zestaw krytyczny zdejmuje rozpoznania przebyte i historię odczytów", () => {
  const c = critical(karta());
  assert.deepEqual(Array.from(c.conditions, x => x.name), ["Migotanie przedsionków", "Cukrzyca typu 2"]);
  assert.equal(c.reads, undefined, "historia odczytów nie jest częścią zestawu jawnego");
  assert.equal(c.tagId, "HERO-2481-KX");
  assert.equal(c.person.name, "Anna Wiśniewska");
  assert.deepEqual(Array.from(critical({ tagId: "X" }).conditions, x => x), [], "karta bez sekcji nie wywraca odczytu");
});

test("alergie idą malejąco po nasileniu", () => {
  assert.deepEqual(Array.from(roAllergies(karta()), a => a.allergen),
    ["Penicylina", "Orzechy ziemne", "Pyłki traw"]);
  assert.deepEqual(Array.from(roAllergies({ allergies: [{ allergen: "A", severity: "4" }, { allergen: "B", severity: "2" }] }), a => a.allergen),
    ["A", "B"], "nasilenie zapisane tekstem sortuje się tak samo");
  assert.equal(roAllergies({}).length, 0);
});

test("antykoagulanty stają na początku listy leków", () => {
  assert.deepEqual(Array.from(roMeds(karta()), m => m.name), ["Rywaroksaban", "Metformina", "Lewotyroksyna"]);
  assert.equal(roMeds({}).length, 0);
});

test("pasek flag niesie to, co zmienia decyzje na miejscu zdarzenia", () => {
  const f = roFlags(karta());
  assert.deepEqual(Array.from(f, x => x.tekst), [
    "Anafilaksja: Penicylina",
    "Anafilaksja: Orzechy ziemne",
    "Antykoagulant: Rywaroksaban",
    "Wszczep / urządzenie",
    "Dawca narządów",
  ]);
  assert.deepEqual(Array.from(f, x => x.waga), ["crit", "crit", "crit", "warn", "ok"]);

  const zDnr = karta();
  zDnr.person.dnr = true;
  assert.ok(Array.from(roFlags(zDnr), x => x.tekst).includes("DNR — zgłoszone oświadczenie"));

  const lekka = { person: {}, allergies: [{ allergen: "Pyłki", severity: 2 }], meds: [{ name: "Witamina D" }] };
  assert.equal(roFlags(lekka).length, 0, "alergia poniżej ciężkiej i lek bez antykoagulacji nie są flagą");
});

test("podsumowanie do przekazania trzyma tę samą kolejność co ekran", () => {
  const t = handoverText(karta(), 58);
  const linie = t.split("\n");
  assert.equal(linie[0], "HERO — karta ratunkowa MediTag HERO-2481-KX");
  assert.equal(linie[1], "Pacjent: Anna Wiśniewska, 58 lat, grupa A+");
  assert.equal(linie[2], "Alergie: Penicylina (anafilaksja); Orzechy ziemne (ciężka); Pyłki traw (łagodna)");
  assert.match(linie[3], /^Leki: Rywaroksaban 20 mg \[ANTYKOAGULANT\]/);
  assert.match(t, /Wszczepy\/urządzenia: Stymulator serca Medtronic/);
  assert.match(t, /Kontakt: Marek Wiśniewski \(mąż\) \+48 601 234 567/, "kontakt pierwszego wyboru, nie pierwszy z listy");
  assert.doesNotMatch(t, /DNR/, "bez oświadczenia nie ma o czym pisać");

  const pusta = handoverText({ tagId: "HERO-1", person: {} }, null);
  assert.match(pusta, /Pacjent: nieznany/);
  assert.match(pusta, /Alergie: brak zgłoszonych/);
  assert.match(pusta, /Leki: brak zgłoszonych/);
});
