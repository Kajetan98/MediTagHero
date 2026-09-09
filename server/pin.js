import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * PIN-y nie są przechowywane w postaci jawnej. Przeglądarka wysyła skrót
 * SHA-256 z PIN-u i identyfikatora opaski, serwer przelicza go jeszcze raz
 * przez scrypt z losową solą. Wyciek bazy nie ujawnia więc ani PIN-u,
 * ani wartości, którą wysyła klient.
 */
const N = 16384, r = 8, p = 1, KEYLEN = 32;

export function hashPin(clientDigest) {
  const salt = randomBytes(16);
  const key = scryptSync(String(clientDigest), salt, KEYLEN, { N, r, p });
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPin(clientDigest, stored) {
  if (!stored) return false;
  const [scheme, saltHex, keyHex] = String(stored).split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const key = scryptSync(String(clientDigest || ""), Buffer.from(saltHex, "hex"), KEYLEN, { N, r, p });
  const want = Buffer.from(keyHex, "hex");
  return key.length === want.length && timingSafeEqual(key, want);
}
