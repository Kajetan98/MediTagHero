import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "../server/index.js";
import { openDatabase } from "../server/db.js";

const TAG = "HERO-1000-AA";
const digest = (tag, pin) => createHash("sha256").update(`hero:${tag}:${pin}`).digest("hex");
const PIN = digest(TAG, "4321");

let server, base;
const call = (path, opts = {}) => fetch(base + path, opts);
const json = async (path, opts) => { const r = await call(path, opts); return { status: r.status, body: r.status === 204 ? null : await r.json() }; };
const put = (path, body, pin, doctor) => json(path, {
  method: "PUT",
  headers: { "content-type": "application/json", ...(pin ? { "x-hero-pin": pin } : {}), ...(doctor ? { "x-hero-doctor": doctor } : {}) },
  body: JSON.stringify(body),
});
const post = (path, body, doctor) => json(path, {
  method: "POST",
  headers: { "content-type": "application/json", ...(doctor ? { "x-hero-doctor": doctor } : {}) },
  body: JSON.stringify(body),
});
const LEKARZ = { pwz: "1234567", name: "dr Tomasz Lewandowski", password: "meditag123" };

before(async () => {
  server = createServer(openDatabase(":memory:"));
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const newCard = () => ({
  pinHash: PIN,
  person: { name: "Jan Kowalski", blood: "0", rh: "-", birthDate: "1980-05-02" },
  allergies: [{ id: "a1", allergen: "Penicylina", kind: "lek", severity: 4, source: "lekarz" }],
  meds: [{ id: "m1", name: "Rywaroksaban", anticoag: true, dose: "20 mg", source: "lekarz" }],
  conditions: [{ id: "c1", name: "Migotanie przedsionków", icd10: "I48", status: "aktywna", source: "lekarz" }],
  contacts: [{ id: "k1", name: "Anna Kowalska", phone: "+48 600 100 200", primary: true }]
});

test("health opisuje usługę", async () => {
  const { status, body } = await json("/api/health");
  assert.equal(status, 200);
  assert.equal(body.service, "hero");
});

test("nowa karta powstaje, druga próba bez PIN-u jej nie nadpisze", async () => {
  const created = await put(`/api/cards/${TAG}`, newCard());
  assert.equal(created.status, 201);
  assert.equal(created.body.person.name, "Jan Kowalski");

  const blocked = await put(`/api/cards/${TAG}`, { person: { name: "Podszywacz" } }, "zly-pin");
  assert.equal(blocked.status, 403);

  const still = await json(`/api/cards/${TAG}`);
  assert.equal(still.body.person.name, "Jan Kowalski");
});

test("odczyt ratunkowy nie wymaga PIN-u i nie ujawnia PIN-u ani historii", async () => {
  const { status, body } = await json(`/api/cards/${TAG}`);
  assert.equal(status, 200);
  assert.equal(body.allergies[0].allergen, "Penicylina");
  assert.equal(body.meds[0].anticoag, true);
  assert.equal(body.pinHash, undefined);
  assert.equal(body.reads, undefined);
});

test("każdy odczyt trafia do historii dostępnej po PIN-ie", async () => {
  const logged = await json(`/api/cards/${TAG}/reads`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ by: "ZRM P-12", ctx: "odczyt ratunkowy" })
  });
  assert.equal(logged.status, 201);
  assert.match(logged.body.at, /^\d{4}-\d{2}-\d{2}T/);

  const session = await json(`/api/cards/${TAG}/session`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest: PIN })
  });
  assert.equal(session.status, 200);
  assert.equal(session.body.reads.length, 1);
  assert.equal(session.body.reads[0].by, "ZRM P-12");
});

test("zły PIN nie otwiera karty, nieznana opaska daje 404", async () => {
  const bad = await json(`/api/cards/${TAG}/session`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest: "0".repeat(64) })
  });
  assert.equal(bad.status, 403);

  const missing = await json("/api/cards/HERO-9999-ZZ");
  assert.equal(missing.status, 404);
});

test("bez konta lekarza wpis oznaczony jako lekarski zapisuje się jako pacjenta", async () => {
  const card = newCard();
  card.meds.push({ id: "m2", name: "Metformina", dose: "1000 mg", source: "lekarz" });
  card.updatedBy = "lekarz";
  const saved = await put(`/api/cards/${TAG}`, card, PIN);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.meds.length, 2);
  assert.equal(saved.body.updatedBy, "pacjent");
  assert.equal(saved.body.meds[1].source, "pacjent");
  assert.equal(saved.body.meds[1].signedBy, undefined);
});

test("konto lekarza wymaga siedmiu cyfr PWZ, hasła i unikalnego numeru", async () => {
  assert.equal((await post("/api/doctors", { ...LEKARZ, pwz: "12345" })).status, 400);
  assert.equal((await post("/api/doctors", { ...LEKARZ, name: "X" })).status, 400);
  assert.equal((await post("/api/doctors", { ...LEKARZ, password: "krotkie" })).status, 400);

  const utworzone = await post("/api/doctors", LEKARZ);
  assert.equal(utworzone.status, 201);
  assert.equal(utworzone.body.pwz, LEKARZ.pwz);
  assert.equal(utworzone.body.pass, undefined);

  assert.equal((await post("/api/doctors", LEKARZ)).status, 409);
});

test("logowanie lekarza: złe hasło odrzucone, dobre daje token i konto", async () => {
  assert.equal((await post("/api/doctors/session", { pwz: LEKARZ.pwz, password: "nie to" })).status, 403);
  assert.equal((await post("/api/doctors/session", { pwz: "7654321", password: LEKARZ.password })).status, 403);

  const zalogowany = await post("/api/doctors/session", { pwz: LEKARZ.pwz, password: LEKARZ.password });
  assert.equal(zalogowany.status, 200);
  assert.ok(zalogowany.body.token);

  const ja = await json("/api/doctors/me", { headers: { "x-hero-doctor": zalogowany.body.token } });
  assert.equal(ja.status, 200);
  assert.equal(ja.body.pwz, LEKARZ.pwz);
  assert.equal((await json("/api/doctors/me", { headers: { "x-hero-doctor": "podrobiony" } })).status, 403);
});

test("wpis dodany z konta lekarza dostaje podpis z numerem PWZ", async () => {
  const { body: sesja } = await post("/api/doctors/session", { pwz: LEKARZ.pwz, password: LEKARZ.password });
  const card = newCard();
  card.conditions.push({ id: "c2", name: "Cukrzyca typu 2", icd10: "E11", status: "kontrolowana", source: "lekarz" });
  const saved = await put(`/api/cards/${TAG}`, card, PIN, sesja.token);

  assert.equal(saved.status, 200);
  assert.equal(saved.body.updatedBy, "lekarz");
  const dopisany = saved.body.conditions.find(c => c.id === "c2");
  assert.equal(dopisany.source, "lekarz");
  assert.equal(dopisany.signedBy.pwz, LEKARZ.pwz);
  assert.equal(dopisany.signedBy.name, LEKARZ.name);
  assert.match(dopisany.signedBy.at, /^\d{4}-\d{2}-\d{2}T/);
});

test("podpisu zapisanego wpisu nie da się zmienić ani zdjąć", async () => {
  const podszywacz = { pwz: "7654321", name: "dr Anna Podszywacz", password: "meditag123" };
  await post("/api/doctors", podszywacz);
  const { body: sesja } = await post("/api/doctors/session", { pwz: podszywacz.pwz, password: podszywacz.password });

  const { body: karta } = await json(`/api/cards/${TAG}`);
  const zmieniona = { ...karta, conditions: karta.conditions.map(c =>
    c.id === "c2" ? { ...c, signedBy: { name: "dr Nikt", pwz: "0000000" } } : c) };
  const saved = await put(`/api/cards/${TAG}`, zmieniona, PIN, sesja.token);

  const dopisany = saved.body.conditions.find(c => c.id === "c2");
  assert.equal(dopisany.signedBy.pwz, LEKARZ.pwz, "podpis zostaje przy pierwszym lekarzu");

  const bezPodpisu = { ...karta, conditions: karta.conditions.map(c =>
    c.id === "c2" ? { ...c, signedBy: undefined, source: "pacjent" } : c) };
  const drugi = await put(`/api/cards/${TAG}`, bezPodpisu, PIN);
  assert.equal(drugi.body.conditions.find(c => c.id === "c2").signedBy.pwz, LEKARZ.pwz);
});

test("dostęp lekarza zapisuje się w historii z jego konta, nie z formularza", async () => {
  const { body: sesja } = await post("/api/doctors/session", { pwz: LEKARZ.pwz, password: LEKARZ.password });
  const wpis = await post(`/api/cards/${TAG}/reads`, { by: "ktoś zupełnie inny", ctx: "cokolwiek" }, sesja.token);
  assert.equal(wpis.status, 201);
  assert.equal(wpis.body.by, `${LEKARZ.name}, PWZ ${LEKARZ.pwz}`);
  assert.equal(wpis.body.ctx, "dostęp lekarza");
});

test("kartę usuwa tylko właściciel PIN-u, razem z historią", async () => {
  assert.equal((await json(`/api/cards/${TAG}`, { method: "DELETE" })).status, 403);
  assert.equal((await json(`/api/cards/${TAG}`, { method: "DELETE", headers: { "x-hero-pin": PIN } })).status, 204);
  assert.equal((await json(`/api/cards/${TAG}`)).status, 404);
});

test("serwer oddaje aplikację pod adresem głównym", async () => {
  const r = await call("/");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<title>HERO<\/title>/);
  assert.match(html, /Odczyt ratunkowy/);
});
