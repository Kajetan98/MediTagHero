import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

/**
 * Logika adresu opaski leży w web/app.html, bo aplikacja jest jednym plikiem. Test wycina z niej
 * blok NFC:START … NFC:END i uruchamia go osobno — bez przeglądarki i bez sprzętu NFC.
 */
const src = readFileSync(new URL("../web/app.html", import.meta.url), "utf8");
const blok = src.match(/\/\* NFC:START[\s\S]*?\/\* NFC:END \*\//);
assert.ok(blok, "w web/app.html nie ma bloku NFC:START … NFC:END");
const { appBase, tagUrl, tagFromText, genTag, TAG_RE } = runInNewContext(
  "(function(){" + blok[0] + "\nreturn {appBase, tagUrl, tagFromText, genTag, TAG_RE};})()",
  { crypto });

const TAG = "HERO-2481-KX";

test("adres opaski powstaje z adresu, pod którym chodzi aplikacja", () => {
  assert.equal(appBase({ origin: "https://hero.example", pathname: "/index.html" }), "https://hero.example/");
  assert.equal(appBase({ origin: "https://kajetan98.github.io", pathname: "/web/hero-app/" }), "https://kajetan98.github.io/web/hero-app/");
  assert.equal(tagUrl(TAG, "https://hero.example/"), "https://hero.example/#/t/" + TAG);
});

test("plik otwarty z dysku nie daje adresu do zapisania", () => {
  assert.equal(appBase({ origin: "null", pathname: "/home/ktos/app.html" }), "");
});

test("identyfikator wraca z adresu, który sam zapisaliśmy", () => {
  assert.equal(tagFromText(tagUrl(TAG, "https://hero.example/")), TAG);
});

test("identyfikator wraca z zapisów innego kształtu", () => {
  assert.equal(tagFromText("https://hero.example/t/" + TAG), TAG, "ścieżka zamiast kotwicy");
  assert.equal(tagFromText("https://hero.example/#/odczyt?tag=" + TAG), TAG, "stary adres odczytu");
  assert.equal(tagFromText("  hero-2481-kx  "), TAG, "sam identyfikator, małymi literami");
});

test("treść spoza opaski HERO nie udaje identyfikatora", () => {
  assert.equal(tagFromText("https://example.com/promocja"), null);
  assert.equal(tagFromText(""), null);
  assert.equal(tagFromText("ok"), null, "identyfikator ma co najmniej trzy znaki");
  assert.equal(tagFromText("-HERO-1"), null, "identyfikator nie zaczyna się myślnikiem");
});

test("identyfikator opaski niesie 128 bitów losowości", () => {
  const tag = genTag();
  assert.match(tag, /^HERO-[0-9A-HJKMNP-TV-Z]{26}$/, "prefiks i 26 znaków base32 Crockforda: " + tag);
  assert.equal(tag.length, 31, "musi zmieścić się w 32 znakach, które przepuszcza serwer");
  assert.ok(TAG_RE.test(tag), "serwer przyjmuje ten identyfikator");
  assert.equal(tagFromText(tagUrl(tag, "https://hero.example/")), tag, "wraca z adresu opaski");

  const widziane = new Set();
  for (let i = 0; i < 2000; i++) widziane.add(genTag());
  assert.equal(widziane.size, 2000, "dwa tysiące losowań bez powtórzenia");
});

test("stary, krótki identyfikator działa dalej", () => {
  assert.ok(TAG_RE.test("HERO-2481-KX"), "karta przykładowa z seeda");
  assert.equal(tagFromText("https://hero.example/#/t/HERO-2481-KX"), "HERO-2481-KX");
});
