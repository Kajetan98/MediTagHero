import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Sekrety nie są przechowywane w postaci jawnej: dotyczy to PIN-ów kart
 * i haseł do kont lekarzy.
 *
 * PIN karty: przeglądarka wysyła skrót SHA-256 z PIN-u i identyfikatora opaski,
 * serwer przelicza go jeszcze raz przez scrypt z losową solą. Wyciek bazy nie
 * ujawnia więc ani PIN-u, ani wartości, którą wysyła klient.
 *
 * Hasło lekarza: trafia na serwer w postaci jawnej po TLS i od razu idzie
 * przez scrypt — poza bazą nie zostaje nigdzie zapisane.
 */
const N = 16384, r = 8, p = 1, KEYLEN = 32;

export function hashSecret(secret) {
  const salt = randomBytes(16);
  const key = scryptSync(String(secret), salt, KEYLEN, { N, r, p });
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifySecret(secret, stored) {
  if (!stored) return false;
  const [scheme, saltHex, keyHex] = String(stored).split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const key = scryptSync(String(secret || ""), Buffer.from(saltHex, "hex"), KEYLEN, { N, r, p });
  const want = Buffer.from(keyHex, "hex");
  return key.length === want.length && timingSafeEqual(key, want);
}
