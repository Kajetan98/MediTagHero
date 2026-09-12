import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

/**
 * Zawartość odczytu ratunkowego. To jedyne miejsce, które decyduje, co ratownik zobaczy na miejscu
 * zdarzenia i w jakiej kolejności — dlatego jest wycięte z web/app.html jako osobny blok i sprawdzane
 * bez przeglądarki. Ten sam blok opisuje zestaw ratunkowy, czyli zakres, jaki `GET /api/cards/:tag`
 * wydaje bez konta zawodowego — serwer liczy go sam, w `rescueCard`.
 */
const src = readFileSync(new URL("../web/app.html", import.meta.url), "utf8");
const blok = src.match(/\/\* KARTA:START[\s\S]*?\/\* KARTA:END \*\//);
assert.ok(blok, "w web/app.html nie ma bloku KARTA:START … KARTA:END");
/* `rescueOf` liczy wiek helperem `age` z tego samego pliku — bierzemy go stąd, żeby test nie
   dublował logiki obliczania wieku. */
const ageSrc = src.match(/^const age = .*$/m);
assert.ok(ageSrc, "w web/app.html nie ma helpera age");
/* Napisy przechodzą przez `t()`/`tf()`. Tutaj sprawdzamy wersję polską, czyli zachowanie bez
   tłumaczenia; pokrycie słownika angielskiego pilnuje test/i18n.test.js. */
const stubJezyka = 'const t = x => x; const tf = (pl, ...w) => pl.replace(/\\{(\\d)\\}/g, (_, i) => w[Number(i)]);';
const { critical, rescueOf, roAllergies, roMeds, roFlags, handoverText } = runInNewContext(
  "(function(){" + stubJezyka + "\n" + ageSrc[0] + "\n" + blok[0] + "\nreturn {critical, rescueOf, roAllergies, roMeds, roFlags, handoverText};})()");

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

test("zestaw ratunkowy zdejmuje dane identyfikujące, zostawia to, co ratuje", () => {
  const r = rescueOf(karta());
  assert.equal(r.rescue, true);
  assert.equal(r.person.name, undefined, "nazwisko nie wychodzi bez konta");
  assert.equal(r.person.birthDate, undefined, "data urodzenia identyfikuje pacjenta");
  assert.equal(r.contacts, undefined, "kontaktów alarmowych nie ma w zestawie ratunkowym");
  assert.equal(r.reads, undefined, "historii odczytów też nie");
  assert.equal(r.person.blood + r.person.rh, "A+");
  assert.equal(r.person.devices, "Stymulator serca Medtronic", "wszczep zostaje — zmienia decyzje");
  assert.equal(r.person.donor, true);
  assert.equal(typeof r.person.ageYears, "number", "sam wiek zostaje, bo nie wskazuje osoby");

  assert.deepEqual(Array.from(r.meds, m => m.name), ["Rywaroksaban"],
    "z leków zostają same antykoagulanty");
  assert.deepEqual(Array.from(r.conditions, c => c.name), ["Migotanie przedsionków", "Cukrzyca typu 2"],
    "rozpoznanie przebyte odpada, kontrolowane zostaje");
  assert.deepEqual(Array.from(roAllergies(r), a => a.allergen), ["Penicylina", "Orzechy ziemne", "Pyłki traw"],
    "alergie zostają w całości");

  const pusta = rescueOf({ tagId: "HERO-1" });
  assert.equal(pusta.person.blood, "");
  assert.deepEqual(Array.from(pusta.meds), []);
  assert.equal(pusta.person.ageYears, null, "bez daty urodzenia nie ma wieku");
});

test("podsumowanie z zestawu ratunkowego mówi, że jest niepełne", () => {
  const t = handoverText(rescueOf(karta()), 58);
  assert.match(t, /Zakres: zestaw ratunkowy/);
  assert.match(t, /Pacjent: nieznany, 58 lat, grupa A\+/);
  assert.doesNotMatch(t, /Kontakt:/, "kontaktu nie ma czego przekazać");
  assert.doesNotMatch(handoverText(karta(), 58), /Zakres:/, "pełna karta nie potrzebuje adnotacji");
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
