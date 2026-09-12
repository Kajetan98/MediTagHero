import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

/**
 * Ustawienia: język i motyw. Oba mają trzy stany — „auto" (idziemy za urządzeniem), a poza tym
 * wybór zapamiętany w `localStorage`. Rozstrzyganie tych stanów nie dotyka DOM-u, więc da się
 * wyciąć z `web/app.html` i uruchomić bez przeglądarki.
 */
const src = readFileSync(new URL("../web/app.html", import.meta.url), "utf8");
const kawalki = src.split("<script>");
const skrypt = kawalki[kawalki.length - 1].split("</script>")[0];
const przedAplikacja = kawalki.slice(0, -1).join("<script>");

const wytnij = (re, opis) => {
  const m = skrypt.match(re);
  assert.ok(m, "w web/app.html nie ma: " + opis);
  return m[0];
};
const stala = nazwa => {
  const m = skrypt.match(new RegExp("const " + nazwa + ' = "([^"]+)";'));
  assert.ok(m, "w web/app.html nie ma stałej " + nazwa);
  return m[1];
};

const LSL = stala("LSL");
const LST = stala("LST");
const wyborJezyka = wytnij(/const jezykPrzegladarki = [\s\S]*?\nlet LANG = .*?;/, "wyboru języka");
const wyborMotywu = wytnij(/const MOTYWY = \[[\s\S]*?\nlet MOTYW = zapamietanyMotyw\(\);/, "wyboru motywu");

const pamiec = zapisane => ({ getItem: k => (k in zapisane ? zapisane[k] : null) });

/* `Array.from`, bo tablica z `node:vm` ma inny prototyp i nie przechodzi porównania wprost. */
const jezyk = (zapamietany, przegladarka) => Array.from(runInNewContext(
  "(function(){" + wyborJezyka + "\nreturn [LANG, LANG_WYBOR];})()",
  { LSL, localStorage: pamiec(zapamietany === null ? {} : { [LSL]: zapamietany }),
    navigator: { language: przegladarka } }));

const motyw = zapamietany => runInNewContext(
  "(function(){" + wyborMotywu + "\nreturn MOTYW;})()",
  { LST, localStorage: pamiec(zapamietany === null ? {} : { [LST]: zapamietany }) });

test("język bierze się z ustawienia, a bez niego z telefonu", () => {
  assert.deepEqual(jezyk(null, "pl-PL"), ["pl", "auto"], "polski telefon dostaje polski");
  assert.deepEqual(jezyk(null, "en-GB"), ["en", "auto"], "angielski telefon dostaje angielski bez klikania");
  assert.deepEqual(jezyk(null, "de-DE"), ["pl", "auto"], "inny język schodzi do polskiego");
  assert.deepEqual(jezyk("pl", "en-GB"), ["pl", "pl"], "zapamiętany wybór wygrywa z językiem telefonu");
  assert.deepEqual(jezyk("en", "pl-PL"), ["en", "en"]);
  assert.deepEqual(jezyk("auto", "en-GB"), ["en", "auto"], "ustawienie „jak w telefonie” nic nie zapamiętuje");
  assert.deepEqual(jezyk("xx", "pl-PL"), ["pl", "auto"], "śmieci w pamięci nie zmieniają języka");
});

test("motyw bierze się z ustawienia, a bez niego z systemu", () => {
  assert.equal(motyw(null), "auto", "bez wyboru idziemy za systemem");
  assert.equal(motyw("light"), "light");
  assert.equal(motyw("dark"), "dark");
  assert.equal(motyw("auto"), "auto");
  assert.equal(motyw("niebieski"), "auto", "śmieci w pamięci nie zmieniają motywu");
});

test("motyw ustawia się przed pierwszym rysowaniem", () => {
  /* Skrypt w treści strony czyta ten sam klucz co aplikacja — inaczej ciemny wybór mrugnąłby
     jasnym tłem, zanim doczyta się właściwy skrypt. */
  const wczesny = przedAplikacja.match(/localStorage\.getItem\("([^"]+)"\)[\s\S]{0,200}?setAttribute\("data-theme"/);
  assert.ok(wczesny, "w treści strony nie ma skryptu ustawiającego motyw przed rysowaniem");
  assert.equal(wczesny[1], LST, "wczesny skrypt czyta inny klucz niż aplikacja");
});

test("oba motywy mają komplet zmiennych, a jasny jest domyślny", () => {
  const style = src.match(/<style>[\s\S]*?<\/style>/g).join("\n");
  const zmienne = blok => new Set((blok.match(/--[a-z0-9-]+\s*:/g) || []).map(v => v.replace(/\s*:$/, "")));
  const jasny = style.match(/:root\{[\s\S]*?\n\}/);
  const ciemnySystem = style.match(/@media \(prefers-color-scheme:dark\)\{[\s\S]*?\n  \}/);
  const ciemnyWybor = style.match(/:root\[data-theme="dark"\]\{[\s\S]*?\n\}/);
  assert.ok(jasny && ciemnySystem && ciemnyWybor, "w arkuszu brakuje któregoś z motywów");

  const wJasnym = zmienne(jasny[0]);
  for (const v of zmienne(ciemnyWybor[0])) {
    assert.ok(wJasnym.has(v), "zmienna " + v + " jest tylko w ciemnym motywie");
  }
  assert.deepEqual([...zmienne(ciemnySystem[0])].sort(), [...zmienne(ciemnyWybor[0])].sort(),
    "ciemny z systemu i ciemny z wyboru muszą definiować to samo");
  assert.match(ciemnySystem[0], /:root:not\(\[data-theme="light"\]\)/,
    "ciemny z systemu musi ustępować wyborowi jasnego motywu");
});
