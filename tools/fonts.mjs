#!/usr/bin/env node
/**
 * Wstawia kroje pisma do web/app.html jako data URI.
 *
 * Aplikacja jest jednym plikiem i chodzi w trzech miejscach: na stronie SPACER
 * pod hero-app/, na serwerze HERO i jako Artifact. Odnośnik do pliku .woff2
 * byłby poprawny tylko w pierwszym z nich, a Artifact i tak wpuszcza wyłącznie
 * kroje z Google Fonts — dlatego pliki lądują w treści, a nie obok niej.
 *
 * Kroje: Plus Jakarta Sans i Space Mono, te same, których używa strona SPACER
 * (licencja SIL OFL, treść w assets/fonts/OFL-*.txt).
 *
 * Uruchomienie: node tools/fonts.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Zakresy znaków w podziale Google Fonts: „latin" to alfabet podstawowy,
// „latin-ext" dodaje między innymi polskie znaki diakrytyczne.
const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT = "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";

const FACES = [
  { family: "Plus Jakarta Sans", weight: "200 800", file: "PlusJakartaSans-latin-ext.woff2", range: LATIN_EXT },
  { family: "Plus Jakarta Sans", weight: "200 800", file: "PlusJakartaSans-latin.woff2", range: LATIN },
  { family: "Space Mono", weight: "400", file: "SpaceMono-400-latin-ext.woff2", range: LATIN_EXT },
  { family: "Space Mono", weight: "400", file: "SpaceMono-400-latin.woff2", range: LATIN },
  { family: "Space Mono", weight: "700", file: "SpaceMono-700-latin-ext.woff2", range: LATIN_EXT },
  { family: "Space Mono", weight: "700", file: "SpaceMono-700-latin.woff2", range: LATIN },
];

const blocks = [];
let bytes = 0;
for (const f of FACES) {
  const blob = await readFile(join(root, "assets/fonts", f.file));
  bytes += blob.length;
  blocks.push(
    `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:swap;` +
    `src:url("data:font/woff2;base64,${blob.toString("base64")}") format('woff2');` +
    `unicode-range:${f.range}}`
  );
  console.log(`${f.file.padEnd(34)} ${String(Math.round(blob.length / 1024)).padStart(3)} kB  ${f.family} ${f.weight}`);
}

const path = join(root, "web/app.html");
const src = await readFile(path, "utf8");
const block = "/* FONTS:START */\n" + blocks.join("\n") + "\n/* FONTS:END */";
const out = src.replace(/\/\* FONTS:START \*\/[\s\S]*?\/\* FONTS:END \*\//, () => block);
if (out === src && !src.includes("/* FONTS:START */")) {
  throw new Error("W web/app.html brakuje znaczników /* FONTS:START */ i /* FONTS:END */");
}
await writeFile(path, out);
console.log(`\nwstawiono ${Math.round(bytes / 1024)} kB krojów, web/app.html ma teraz ${Math.round(out.length / 1024)} kB`);
