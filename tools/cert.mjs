#!/usr/bin/env node
/**
 * Certyfikat samopodpisany do testów na telefonie. Web NFC i `crypto.subtle` żądają bezpiecznego
 * kontekstu, a ten poza `localhost` znaczy HTTPS — bez certyfikatu opaski nie da się zapisać
 * z telefonu, który wchodzi na serwer po adresie w sieci lokalnej.
 *
 * Do produkcji to nie jest droga: certyfikat samopodpisany trzeba w telefonie zaakceptować ręcznie
 * albo zainstalować jako zaufany. Tam idzie certyfikat z urzędu (Let's Encrypt) na reverse proxy —
 * patrz sekcja o wdrożeniu w README.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "data/tls");
const key = join(dir, "key.pem");
const cert = join(dir, "cert.pem");

/** Adresy, pod którymi telefon zobaczy ten serwer; bez nich przeglądarka odrzuci certyfikat. */
function adresy() {
  const out = ["DNS:localhost", "IP:127.0.0.1"];
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === "IPv4" && !i.internal) out.push("IP:" + i.address);
    }
  }
  return out;
}

if (existsSync(key) && existsSync(cert) && !process.argv.includes("--force")) {
  console.log("Certyfikat już jest: data/tls/. Nadpisze go `npm run cert -- --force`.");
} else {
  mkdirSync(dir, { recursive: true });
  const san = adresy();
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "365",
      "-keyout", key, "-out", cert,
      "-subj", "/CN=HERO MediTag (test)",
      "-addext", "subjectAltName=" + san.join(","),
      "-addext", "basicConstraints=critical,CA:FALSE",
    ], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    console.error("Nie udało się wywołać openssl:", String(err.stderr || err.message).trim());
    console.error("Bez openssl zostaje certyfikat z innego źródła albo tunel z własnym TLS-em.");
    process.exit(1);
  }
  console.log("Certyfikat na rok: data/tls/cert.pem, klucz: data/tls/key.pem");
  console.log("Wystawiony na: " + san.join(", "));
}

const lan = adresy().filter(a => a.startsWith("IP:") && a !== "IP:127.0.0.1").map(a => a.slice(3));
console.log("\nUruchomienie:");
console.log("  HERO_TLS_KEY=data/tls/key.pem HERO_TLS_CERT=data/tls/cert.pem npm start");
console.log("\nZ telefonu w tej samej sieci:");
for (const ip of lan.length ? lan : ["<adres tego komputera>"]) console.log("  https://" + ip + ":8443");
console.log("\nTelefon pokaże ostrzeżenie o certyfikacie — trzeba je przejść ręcznie.");
console.log("Chrome na Androidzie daje Web NFC dopiero, gdy strona jest uznana za bezpieczną, więc");
console.log("jeśli po przejściu ostrzeżenia zapis opaski zostaje wyłączony, zainstaluj cert.pem");
console.log("w telefonie jako zaufany (Ustawienia → Bezpieczeństwo → Certyfikaty) albo postaw tunel.");
