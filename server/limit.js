/**
 * Licznik żądań w oknie czasu, trzymany w pamięci procesu. Wystarcza jednemu serwerowi;
 * przy kilku instancjach potrzebny będzie wspólny magazyn (punkt „limit żądań" w planie rozwoju).
 */
export function rateLimiter({ limit = 30, windowMs = 60_000 } = {}) {
  const hits = new Map();
  return {
    allow(key) {
      const now = Date.now();
      const fresh = (hits.get(key) || []).filter(t => now - t < windowMs);
      hits.set(key, fresh);
      if (fresh.length >= limit) return false;
      fresh.push(now);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] >= windowMs) hits.delete(k);
      return true;
    }
  };
}
