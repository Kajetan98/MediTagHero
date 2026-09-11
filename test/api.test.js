import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, tlsFromEnv } from "../server/index.js";
import { openDatabase } from "../server/db.js";
import { rateLimiter } from "../server/limit.js";

const TAG = "HERO-1000-AA";
const digest = (tag, pin) => createHash("sha256").update(`hero:${tag}:${pin}`).digest("hex");
const PIN = digest(TAG, "4321");

let server, store, base;
/* Drugi serwer na tej samej bazie. Test zalewania historii zużywa limit odczytów na całą minutę,
   więc to, co trzeba sprawdzić po tamtym teście, idzie przez serwer z nietkniętymi licznikami. */
let swiezy, baseSwiezy;
const call = (path, opts = {}, adres = base) => fetch(adres + path, opts);
const json = async (path, opts, adres) => { const r = await call(path, opts, adres); return { status: r.status, body: r.status === 204 ? null : await r.json() }; };
const session = (tag, dg) => json(`/api/cards/${tag}/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest: dg }) });
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
let TOKEN;

before(async () => {
  store = openDatabase(":memory:");
  server = createServer(store, rateLimiter({ limit: 12, windowMs: 60_000 }), rateLimiter({ limit: 5, windowMs: 60_000 }));
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  swiezy = createServer(store, rateLimiter({ limit: 40, windowMs: 60_000 }), rateLimiter({ limit: 20, windowMs: 60_000 }));
  await new Promise(r => swiezy.listen(0, r));
  baseSwiezy = `http://127.0.0.1:${swiezy.address().port}`;
  await post("/api/doctors", LEKARZ);
  TOKEN = (await post("/api/doctors/session", { pwz: LEKARZ.pwz, password: LEKARZ.password })).body.token;
});
after(() => { server.close(); swiezy.close(); });

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

test("lista kart oddaje wyłącznie karty przykładowe", async () => {
  const tag = "HERO-3000-CC";
  const pin = digest(tag, "4321");
  store.cards.upsert(tag, { pinHash: pin, demo: true, person: { name: "Karta demo" } }, pin, { trusted: true });

  const podszyta = "HERO-3001-CD";
  const created = await put(`/api/cards/${podszyta}`, { pinHash: digest(podszyta, "4321"), demo: true }, null);
  assert.equal(created.status, 201);
  assert.equal(created.body.demo, false);

  const { status, body } = await json("/api/cards");
  assert.equal(status, 200);
  assert.deepEqual(body.map(c => c.tagId), [tag]);
  assert.equal((await json("/api/health")).body.cards > body.length, true);
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

test("kontekst odczytu nadaje serwer, dostęp lekarza wymaga konta", async () => {
  const podszyty = await post(`/api/cards/${TAG}/reads`, { by: "ZRM S-04", ctx: "dostęp lekarza" });
  assert.equal(podszyty.status, 403);

  const zmyslony = await post(`/api/cards/${TAG}/reads`, { by: "ZRM S-04", ctx: "kontrola NFZ" });
  assert.equal(zmyslony.body.ctx, "odczyt ratunkowy");

  const lekarz = await post(`/api/cards/${TAG}/reads`, { by: "ktoś zupełnie inny", ctx: "cokolwiek" }, TOKEN);
  assert.equal(lekarz.status, 201);
  assert.equal(lekarz.body.ctx, "dostęp lekarza");
  assert.equal(lekarz.body.by, `${LEKARZ.name}, PWZ ${LEKARZ.pwz}`, "opis bierze się z konta, nie z formularza");
});

/* Zużywa limit odczytów na całą minutę, więc kolejne testy nie dopisują już do historii. */
test("zalewanie historii odczytami kończy się odpowiedzią 429", async () => {
  let last = 201;
  for (let i = 0; i < 20 && last !== 429; i++) {
    last = (await json(`/api/cards/${TAG}/reads`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ by: "bot" }) })).status;
  }
  assert.equal(last, 429);
});

test("zły PIN nie otwiera karty, nieznana opaska daje 404", async () => {
  const bad = await json(`/api/cards/${TAG}/session`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest: "0".repeat(64) })
  });
  assert.equal(bad.status, 403);

  const missing = await json("/api/cards/HERO-9999-ZZ");
  assert.equal(missing.status, 404);
});

test("podpisu lekarza nie nadaje klient", async () => {
  const card = newCard();
  card.meds.push({ id: "m2", name: "Metformina", dose: "1000 mg", source: "lekarz" });
  card.updatedBy = "lekarz";
  const saved = await put(`/api/cards/${TAG}`, card, PIN);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.meds.length, 2);
  assert.equal(saved.body.updatedBy, "pacjent");
  assert.equal(saved.body.meds[1].source, "pacjent");
});

test("podpis z bazy zostaje przy wpisie niezmienionym i znika po edycji", async () => {
  const tag = "HERO-2000-BB";
  const pin = digest(tag, "4321");
  const signed = { id: "m1", name: "Rywaroksaban", dose: "20 mg", anticoag: true, source: "lekarz" };
  store.cards.upsert(tag, { pinHash: pin, person: { name: "Anna Nowak" }, meds: [signed] }, pin, { trusted: true });

  const kept = await put(`/api/cards/${tag}`, { meds: [{ ...signed }] }, pin);
  assert.equal(kept.body.meds[0].source, "lekarz");

  const edited = await put(`/api/cards/${tag}`, { meds: [{ ...signed, dose: "10 mg" }] }, pin);
  assert.equal(edited.body.meds[0].source, "pacjent");

  const forged = await put(`/api/cards/${tag}`, { meds: [{ id: "m9", name: "Warfaryna", source: "lekarz" }] }, pin);
  assert.equal(forged.body.meds[0].source, "pacjent");
});

test("konto lekarza wymaga siedmiu cyfr PWZ, hasła i unikalnego numeru", async () => {
  assert.equal((await post("/api/doctors", { ...LEKARZ, pwz: "12345" })).status, 400);
  assert.equal((await post("/api/doctors", { ...LEKARZ, pwz: "7654321", name: "X" })).status, 400);
  assert.equal((await post("/api/doctors", { ...LEKARZ, pwz: "7654321", password: "krotkie" })).status, 400);
  assert.equal((await post("/api/doctors", LEKARZ)).status, 409, "numer PWZ jest unikalny");

  const utworzone = await post("/api/doctors", { pwz: "7654321", name: "dr Ewa Nowak", password: "meditag123" });
  assert.equal(utworzone.status, 201);
  assert.equal(utworzone.body.pass, undefined, "hasło nie wraca w odpowiedzi");
});

test("logowanie lekarza: złe hasło odrzucone, dobre daje token i konto", async () => {
  assert.equal((await post("/api/doctors/session", { pwz: LEKARZ.pwz, password: "nie to" })).status, 403);
  assert.equal((await post("/api/doctors/session", { pwz: "9999999", password: LEKARZ.password })).status, 403);

  const ja = await json("/api/doctors/me", { headers: { "x-hero-doctor": TOKEN } });
  assert.equal(ja.status, 200);
  assert.equal(ja.body.pwz, LEKARZ.pwz);
  assert.equal((await json("/api/doctors/me", { headers: { "x-hero-doctor": "podrobiony" } })).status, 403);
});

test("wpis dodany z konta lekarza dostaje podpis z numerem PWZ", async () => {
  const tag = "HERO-5000-EE";
  const pin = digest(tag, "4321");
  const utworzona = await put(`/api/cards/${tag}`, { pinHash: pin, person: { name: "Ewa Lis" },
    conditions: [{ id: "c1", name: "Cukrzyca typu 2", icd10: "E11", source: "lekarz" }] }, null, TOKEN);

  assert.equal(utworzona.status, 201);
  assert.equal(utworzona.body.updatedBy, "lekarz");
  const wpis = utworzona.body.conditions[0];
  assert.equal(wpis.source, "lekarz");
  assert.equal(wpis.signedBy.pwz, LEKARZ.pwz);
  assert.equal(wpis.signedBy.name, LEKARZ.name);
  assert.match(wpis.signedBy.at, /^\d{4}-\d{2}-\d{2}T/);

  /* Podpis wraca z serwera, więc kolejny zapis tej samej treści go nie rusza. */
  const bez = await put(`/api/cards/${tag}`, { conditions: [wpis] }, pin);
  assert.equal(bez.body.conditions[0].signedBy.pwz, LEKARZ.pwz);
});

test("podpisu nie da się podmienić ani przypisać sobie", async () => {
  const tag = "HERO-5000-EE";
  const pin = digest(tag, "4321");
  const inny = (await post("/api/doctors/session", { pwz: "7654321", password: "meditag123" })).body.token;
  const { body: karta } = await json(`/api/cards/${tag}`);

  const podmiana = await put(`/api/cards/${tag}`,
    { conditions: [{ ...karta.conditions[0], signedBy: { name: "dr Nikt", pwz: "0000000" } }] }, pin, inny);
  assert.equal(podmiana.body.conditions[0].signedBy.pwz, "7654321",
    "zmieniona treść wpisu dostaje podpis konta, którym idzie zapis, a nie ten z żądania");

  const zdjecie = await put(`/api/cards/${tag}`,
    { conditions: [{ ...karta.conditions[0], signedBy: undefined, source: "pacjent" }] }, pin);
  assert.equal(zdjecie.body.conditions[0].source, "pacjent", "bez konta wpis schodzi do pacjenta");
  assert.equal(zdjecie.body.conditions[0].signedBy, undefined);
});

test("seria błędnych PIN-ów zamyka próby do tej karty", async () => {
  const tag = "HERO-4000-DD";
  const dobry = digest(tag, "4321");
  const zly = digest(tag, "0000");
  assert.equal((await put(`/api/cards/${tag}`, { pinHash: dobry }, null)).status, 201);

  for (let i = 0; i < 4; i++) assert.equal((await session(tag, zly)).status, 403);
  assert.equal((await session(tag, dobry)).status, 200);   /* poprawny PIN kasuje licznik */

  for (let i = 0; i < 5; i++) assert.equal((await session(tag, zly)).status, 403);
  assert.equal((await session(tag, zly)).status, 429);
  assert.equal((await session(tag, dobry)).status, 429);   /* blokada nie ustępuje przed czasem */
  assert.equal((await put(`/api/cards/${tag}`, { pinHash: dobry }, dobry)).status, 429);
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

test("każda odpowiedź niesie nagłówki bezpieczeństwa, HSTS tylko pod TLS-em", async () => {
  for (const sciezka of ["/api/health", "/"]) {
    const r = await call(sciezka);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", sciezka);
    assert.equal(r.headers.get("x-frame-options"), "DENY", sciezka);
    assert.match(r.headers.get("content-security-policy") || "", /default-src 'self'/, sciezka);
    assert.equal(r.headers.get("strict-transport-security"), null, sciezka + " — serwer testowy chodzi po HTTP");
  }
});

test("TLS bierze się ze ścieżek w środowisku albo nie bierze wcale", () => {
  assert.equal(tlsFromEnv({}), null, "bez zmiennych serwer zostaje na HTTP");
  assert.equal(tlsFromEnv({ HERO_TLS_KEY: "a" }), null, "sam klucz bez certyfikatu to nie TLS");

  const dir = mkdtempSync(join(tmpdir(), "hero-tls-"));
  writeFileSync(join(dir, "key.pem"), "klucz");
  writeFileSync(join(dir, "cert.pem"), "certyfikat");
  const wczytane = tlsFromEnv({ HERO_TLS_KEY: join(dir, "key.pem"), HERO_TLS_CERT: join(dir, "cert.pem") });
  assert.equal(wczytane.key.toString(), "klucz");
  assert.equal(wczytane.cert.toString(), "certyfikat");

  assert.throws(() => tlsFromEnv({ HERO_TLS_KEY: join(dir, "nie-ma.pem"), HERO_TLS_CERT: join(dir, "cert.pem") }),
    /certyfikat/i, "brakujący plik zatrzymuje start z czytelnym błędem");
});

/* Poniższe idzie przez `baseSwiezy`: unieważnienie trzeba sprawdzić także na ścieżce odczytu,
   a limit odczytów na pierwszym serwerze jest już zużyty. */
const J = (path, opts) => json(path, opts, baseSwiezy);
const jsonBody = (metoda, body, naglowki = {}) => ({
  method: metoda, headers: { "content-type": "application/json", ...naglowki }, body: JSON.stringify(body),
});

test("unieważniona opaska nie oddaje karty pod starym adresem", async () => {
  const tag = "HERO-6100-KA";
  const pin = digest(tag, "4321");
  assert.equal((await J(`/api/cards/${tag}`, jsonBody("PUT", { ...newCard(), pinHash: pin }))).status, 201);
  assert.equal((await J(`/api/cards/${tag}`)).status, 200);
  assert.equal((await J(`/api/cards/${tag}/reads`, jsonBody("POST", { by: "ZRM P-1" }))).status, 201);

  assert.equal((await J(`/api/cards/${tag}/revoke`, { method: "POST" })).status, 403, "unieważnia tylko właściciel PIN-u");

  const out = await J(`/api/cards/${tag}/revoke`, { method: "POST", headers: { "x-hero-pin": pin } });
  assert.equal(out.status, 200);
  assert.match(out.body.revokedAt, /^\d{4}-\d{2}-\d{2}T/);

  const jawny = await J(`/api/cards/${tag}`);
  assert.equal(jawny.status, 410, "stary adres mówi, że opaska jest odcięta, a nie że karty nie ma");
  assert.equal(jawny.body.revokedAt, out.body.revokedAt);

  const slad = await J(`/api/cards/${tag}/reads`, jsonBody("POST", { by: "ZRM P-2" }));
  assert.equal(slad.status, 410, "nie ma czego pokazać, więc nie ma czego zapisać w historii");

  const sesja = await J(`/api/cards/${tag}/session`, jsonBody("POST", { digest: pin }));
  assert.equal(sesja.status, 200, "pacjent otwiera kartę dalej, bo PIN-u nikt nie zgubił");
  assert.equal(sesja.body.revokedAt, out.body.revokedAt);
  assert.equal(sesja.body.person.name, "Jan Kowalski", "treść karty zostaje");
  assert.equal(sesja.body.reads.length, 1, "historia odczytów tamtej opaski zostaje");

  const drugi = await J(`/api/cards/${tag}/revoke`, { method: "POST", headers: { "x-hero-pin": pin } });
  assert.equal(drugi.body.revokedAt, out.body.revokedAt, "drugie unieważnienie nie przesuwa daty");
});

test("kartę przenosi się na nową opaskę razem z treścią", async () => {
  const stary = "HERO-6200-KB", nowy = "HERO-6300-KC";
  const pinStary = digest(stary, "4321"), pinNowy = digest(nowy, "4321");
  assert.equal((await J(`/api/cards/${stary}`, jsonBody("PUT", { ...newCard(), pinHash: pinStary }))).status, 201);
  assert.equal((await J(`/api/cards/${stary}/reads`, jsonBody("POST", { by: "ZRM P-3" }))).status, 201);

  const ruch = (body, pin) => J(`/api/cards/${stary}/move`, jsonBody("POST", body, pin ? { "x-hero-pin": pin } : {}));

  assert.equal((await ruch({ tagId: nowy, pinHash: pinNowy }, digest(stary, "0000"))).status, 403, "bez PIN-u nie ma przenoszenia");
  assert.equal((await ruch({ tagId: nowy }, pinStary)).status, 400, "nowy adres wymaga skrótu PIN-u przeliczonego dla niego");
  assert.equal((await ruch({ tagId: "nie ma takiego", pinHash: pinNowy }, pinStary)).status, 400);
  assert.equal((await ruch({ tagId: stary, pinHash: pinNowy }, pinStary)).status, 409, "w to samo miejsce nie ma po co");

  const out = await ruch({ tagId: nowy, pinHash: pinNowy }, pinStary);
  assert.equal(out.status, 201);
  assert.equal(out.body.tagId, nowy);
  assert.equal(out.body.person.name, "Jan Kowalski");
  assert.equal(out.body.allergies[0].allergen, "Penicylina", "wpisy przechodzą w całości");
  assert.equal(out.body.reads.length, 0, "nowa opaska startuje z pustą historią");

  assert.equal((await J(`/api/cards/${stary}`)).status, 410, "stara opaska odcięta");
  assert.equal((await J(`/api/cards/${nowy}`)).status, 200, "nowa działa dla ratownika");

  assert.equal((await J(`/api/cards/${nowy}/session`, jsonBody("POST", { digest: pinNowy }))).status, 200,
    "ten sam PIN, skrót przeliczony dla nowego adresu");
  assert.equal((await J(`/api/cards/${nowy}/session`, jsonBody("POST", { digest: pinStary }))).status, 403,
    "stary skrót do nowego adresu nie pasuje");

  const nagrobek = await J(`/api/cards/${stary}/session`, jsonBody("POST", { digest: pinStary }));
  assert.equal(nagrobek.status, 200);
  assert.deepEqual(nagrobek.body.person, {}, "pod starym adresem nie zostaje treść karty");
  assert.equal(nagrobek.body.reads.length, 1, "historia odczytów zostaje przy tamtej opasce");

  assert.equal((await ruch({ tagId: "HERO-6400-KD", pinHash: digest("HERO-6400-KD", "4321") }, pinNowy)).status, 403,
    "skrótem nowej opaski nie przeniesie się starej");
});
