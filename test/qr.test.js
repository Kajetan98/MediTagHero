import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";

/**
 * Koder kodu QR leży w web/app.html, bo aplikacja jest jednym plikiem. Test wycina blok
 * QR:START … QR:END i uruchamia go bez przeglądarki.
 *
 * Wzorce niżej powstały przy pisaniu kodera i zostały potwierdzone poza tym testem: siatki są
 * identyczne z tym, co dla trybu bajtowego i korekcji M daje implementacja referencyjna
 * (python-qrcode), a każdą z nich odczytał dekoder OpenCV — w skali 2, 3, 4 i 8 pikseli na moduł,
 * w czterech obrotach i po rozmyciu. Tutaj pilnują, żeby zmiana w koderze nie przeszła niezauważona.
 */
const src = readFileSync(new URL("../web/app.html", import.meta.url), "utf8");
const blok = src.match(/\/\* QR:START[\s\S]*?\/\* QR:END \*\//);
assert.ok(blok, "w web/app.html nie ma bloku QR:START … QR:END");
const { qrMatrix, qrSvg, qrVersion } = runInNewContext(
  "(function(){" + blok[0] + "\nreturn {qrMatrix, qrSvg, qrVersion};})()", { TextEncoder });

/* `Array.from`, nie `m.map`: siatka powstaje w osobnym kontekście, więc jej tablice mają inny
   prototyp i deepEqual odrzuciłby je mimo tej samej treści. */
const wiersze = m => Array.from(m, r => Array.from(r, v => v ? "1" : "0").join(""));
const skrot = m => createHash("sha256").update(wiersze(m).join("")).digest("hex").slice(0, 16);

/* Kod QR dla „HERO": wersja 1, maska 2. Zapisany w całości, bo na 21 wierszach widać, co się zmieniło. */
const HERO_V1 = [
  "111111100101001111111", "100000100100101000001", "101110101110001011101", "101110101101101011101",
  "101110101001101011101", "100000101010101000001", "111111101010101111111", "000000001101100000000",
  "101111100110101111100", "011010001100100101100", "011001101111010011110", "101100010010000111100",
  "001110110111010011101", "000000001111111000100", "111111100110101100010", "100000101001111001100",
  "101110101110100100110", "101110101010100101000", "101110101011010011000", "100000100110000110100",
  "111111101101010010110",
];

test("kod QR zgadza się ze wzorcem modul po modulu", () => {
  assert.equal(wiersze(qrMatrix("HERO")).join("\n"), HERO_V1.join("\n"));
});

test("adresy opasek dają te same siatki co przy sprawdzeniu dekoderem", () => {
  const wzorce = {
    "https://hero.example/#/t/HERO-2481-KX": ["29x29", "2817e268baf21c27"],
    "https://hero.example/#/t/HERO-9JBG3X2RSQSH1G56Q4H7ZCDMTG": ["33x33", "4da4d0f921e42517"],
    "Zażółć gęślą jaźń": ["25x25", "2368549b7d3e00ff"],
  };
  for (const [tekst, [rozmiar, oczekiwany]] of Object.entries(wzorce)) {
    const m = qrMatrix(tekst);
    assert.equal(m.length + "x" + m.length, rozmiar, tekst);
    assert.equal(skrot(m), oczekiwany, tekst);
  }
});

test("siatka ma to, czego skaner szuka najpierw", () => {
  const m = qrMatrix("https://hero.example/#/t/HERO-2481-KX");
  const n = m.length;
  for (const [oy, ox] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    assert.ok(m[oy][ox] && m[oy + 6][ox] && m[oy][ox + 6] && m[oy + 6][ox + 6], "narożniki znacznika pozycji");
    assert.ok(m[oy + 3][ox + 3], "środek znacznika pozycji");
    assert.ok(!m[oy + 1][ox + 1] && !m[oy + 5][ox + 5], "jasny pierścień w znaczniku");
  }
  for (let i = 8; i < n - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, "linia taktująca w wierszu 6, kolumna " + i);
    assert.equal(m[i][6], i % 2 === 0, "linia taktująca w kolumnie 6, wiersz " + i);
  }
  assert.ok(m[n - 8][8], "moduł, który z normy zawsze jest ciemny");
});

test("wersja rośnie z długością treści, a za długie odpada", () => {
  assert.equal(qrVersion(14), 1, "14 bajtów to granica wersji 1");
  assert.equal(qrVersion(15), 2);
  assert.equal(qrVersion(213), 10, "213 bajtów to granica wersji 10");
  assert.equal(qrVersion(214), null);
  assert.equal(qrMatrix("x".repeat(250)), null, "bez kodu QR zamiast kodu nie do odczytania");
  assert.equal(qrSvg("x".repeat(250)), "", "puste SVG, gdy nie ma czego pokazać");
  assert.equal(qrMatrix("HERO").length, 21);
  assert.equal(qrMatrix("x".repeat(213)).length, 57, "wersja 10 to siatka 57×57");
});

test("SVG rysuje siatkę na białym tle, z marginesem ciszy", () => {
  const svg = qrSvg("HERO", "opis dla czytnika ekranu");
  assert.match(svg, /^<svg class="qr" viewBox="0 0 29 29"/, "21 modułów plus dwa razy cztery moduły ciszy");
  assert.match(svg, /role="img" aria-label="opis dla czytnika ekranu"/);
  assert.match(svg, /shape-rendering="crispEdges"/, "bez wygładzania, inaczej moduły się rozmyją");
  assert.match(svg, /<rect width="29" height="29" fill="#fff"\/>/, "białe tło niezależne od motywu strony");
  const ciemnych = (svg.match(/M\d+ \d+h1v1h-1z/g) || []).length;
  assert.equal(ciemnych, HERO_V1.join("").split("1").length - 1, "tyle prostokątów, ile ciemnych modułów");
});
