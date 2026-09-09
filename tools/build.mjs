#!/usr/bin/env node
/**
 * Wraps the single-file app fragment (web/app.html) into a standalone
 * public/index.html for the HERO server. The same fragment is published
 * as a Claude Artifact, where the host supplies the document skeleton.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = await readFile(join(root, "web/app.html"), "utf8");

const title = (src.match(/<title>([\s\S]*?)<\/title>/) || [, "MediTag HERO"])[1];
const links = src.match(/<link\b[^>]*>/g) || [];
const styles = src.match(/<style>[\s\S]*?<\/style>/g) || [];

let body = src;
for (const chunk of [`<title>${title}</title>`, ...links, ...styles]) body = body.replace(chunk, "");

const html = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="HERO — Health Emergency Read Out. Karta ratunkowa pacjenta dla opaski MediTag NFC.">
<title>${title}</title>
<style>*{box-sizing:border-box}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${links.join("\n")}
${styles.join("\n")}
</head>
<body>
${body.trim()}
</body>
</html>
`;

await mkdir(join(root, "public"), { recursive: true });
await writeFile(join(root, "public/index.html"), html);
console.log("public/index.html <- web/app.html (%d kB)", Math.round(html.length / 1024));
