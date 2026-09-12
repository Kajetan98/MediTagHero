import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

/**
 * Dwujęzyczność aplikacji. Napis widoczny na ekranie idzie przez `t()` albo `tf()`, a kluczem jest
 * jego polska treść — razem ze znacznikami, jeśli literał je niesie. Ten test pilnuje trzech rzeczy:
 * każdy taki napis ma odpowiednik w słowniku `EN`, tłumaczenie ma ten sam szkielet znaczników co
 * oryginał (inaczej podmiana rozwaliłaby układ strony) i te same miejsca na wartości `{0}`.
 */
const src = readFileSync(new URL("../web/app.html", import.meta.url), "utf8");
const szkielet = src.split("<script>")[0];
const skrypt = src.split("<script>")[1].split("</script>")[0];

const blok = skrypt.match(/const EN = \{\n[\s\S]*?\n\};/);
assert.ok(blok, "w web/app.html nie ma słownika EN");
const EN = runInNewContext("(" + blok[0].replace(/^const EN = /, "").replace(/;$/, "") + ")");

/** Treść literału JS bez cudzysłowów, z rozwiniętymi ucieczkami. */
const tresc = lit => lit.slice(1, -1).replace(/\\(['"\\])/g, "$1");

const klucze = [];
for (const m of skrypt.matchAll(/\btf?\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g)) {
  const k = tresc(m[1]);
  if (!klucze.includes(k)) klucze.push(k);
}
/* Napisy w szkielecie strony (pasek górny, stopka) siedzą w atrybutach data-t. */
for (const m of szkielet.matchAll(/data-t(?:-title|-aria)?="([^"]*)"/g)) {
  if (!klucze.includes(m[1])) klucze.push(m[1]);
}
/* Słownictwo danych idzie przez `t(wartość)`, czyli przez zmienną — spis leży w `T_DANE`. */
const dane = skrypt.match(/const T_DANE = \[[\s\S]*?\];/);
assert.ok(dane, "w web/app.html nie ma spisu T_DANE");
for (const k of runInNewContext(dane[0].replace(/^const T_DANE = /, "").replace(/;$/, ""))) {
  if (!klucze.includes(k)) klucze.push(k);
}

/** Nazwy znaczników i nazwy atrybutów. Wartości atrybutów się tłumaczą (placeholder, title). */
const tagi = s => (s.match(/<[^>]+>/g) || []).map(tag => {
  const nazwa = (tag.match(/<\/?\s*([A-Za-z0-9]+)/) || [, tag])[1].toLowerCase();
  return nazwa + "[" + (tag.match(/[A-Za-z-]+\s*=/g) || []).map(a => a.replace(/\s*=$/, "")).sort().join(",") + "]";
});
const miejsca = s => (s.match(/\{\d\}/g) || []).sort();

test("każdy napis objęty tłumaczeniem ma wpis w słowniku angielskim", () => {
  assert.ok(klucze.length > 200, "za mało napisów w tłumaczeniu — coś ucięło wyszukiwanie");
  const brak = klucze.filter(k => !(k in EN));
  assert.deepEqual(brak, [], "napisy bez tłumaczenia: " + brak.slice(0, 5).join(" | "));
});

test("tłumaczenie trzyma szkielet znaczników i miejsca na wartości", () => {
  for (const [pl, en] of Object.entries(EN)) {
    assert.deepEqual(tagi(en), tagi(pl), "inny układ znaczników w: " + pl.slice(0, 70));
    assert.deepEqual(miejsca(en), miejsca(pl), "inne miejsca na wartości w: " + pl.slice(0, 70));
    assert.notEqual(en.trim(), "", "puste tłumaczenie: " + pl.slice(0, 70));
  }
});

test("słownik nie niesie napisów, których w kodzie już nie ma", () => {
  const zbedne = Object.keys(EN).filter(k => !klucze.includes(k));
  assert.deepEqual(zbedne, [], "wpisy bez użycia: " + zbedne.slice(0, 5).join(" | "));
});

test("wybór języka trzyma się przeglądarki i zapamiętanego ustawienia", () => {
  /* Sam wybór języka nie ma DOM-u: to trzy linijki, które da się wyciąć i uruchomić. */
  const wybor = skrypt.match(/let LANG = \(\(\) => \{[\s\S]*?\}\)\(\);/);
  const klucz = skrypt.match(/const LSL = "([^"]+)";/);
  assert.ok(wybor && klucz, "w web/app.html nie ma wyboru języka");
  const jezyk = (zapamietany, przegladarka) => runInNewContext(
    "(function(){" + wybor[0] + "\nreturn LANG;})()",
    { LSL: klucz[1],
      localStorage: { getItem: k => (k === klucz[1] ? zapamietany : null) },
      navigator: { language: przegladarka } });

  assert.equal(jezyk(null, "pl-PL"), "pl", "polski telefon dostaje polski");
  assert.equal(jezyk(null, "en-GB"), "en", "angielski telefon dostaje angielski bez klikania");
  assert.equal(jezyk(null, "de-DE"), "pl", "inny język schodzi do polskiego");
  assert.equal(jezyk("pl", "en-GB"), "pl", "zapamiętany wybór wygrywa z językiem telefonu");
  assert.equal(jezyk("en", "pl-PL"), "en");
  assert.equal(jezyk("xx", "pl-PL"), "pl", "śmieci w pamięci nie zmieniają języka");
});
