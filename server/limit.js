/**
 * Licznik zdarzeń w oknie czasu, trzymany w pamięci procesu. Wystarcza jednemu serwerowi;
 * przy kilku instancjach potrzebny będzie wspólny magazyn (punkt „limit żądań" w planie rozwoju).
 *
 * `allow` liczy każde żądanie (limit ruchu), `blocked` + `record` + `clear` liczą same nieudane
 * próby (limit prób PIN-u, gdzie poprawny PIN kasuje dotychczasowe niepowodzenia).
 */
export function rateLimiter({ limit = 30, windowMs = 60_000 } = {}) {
  const hits = new Map();
  const fresh = (key, now) => {
    const kept = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (kept.length) hits.set(key, kept); else hits.delete(key);
    return kept;
  };
  const sweep = now => { if (hits.size > 5000) for (const k of [...hits.keys()]) fresh(k, now); };

  return {
    blocked(key) { return fresh(key, Date.now()).length >= limit; },
    record(key) {
      const now = Date.now();
      hits.set(key, fresh(key, now).concat(now));
      sweep(now);
    },
    clear(key) { hits.delete(key); },
    allow(key) {
      if (this.blocked(key)) return false;
      this.record(key);
      return true;
    }
  };
}
