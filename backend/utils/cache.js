// ============================================================
// TicTacArena — Simple In-Memory Cache
// Usage: const cache = require('./utils/cache');
//        const data = await cache.getOrSet('key', 30, async () => fetchData());
// ============================================================

const store = new Map();

/**
 * Get cached value or compute and cache it.
 * @param {string} key - Cache key
 * @param {number} ttlSeconds - Time-to-live in seconds
 * @param {Function} fetchFn - Async function to compute value if cache miss
 * @returns {Promise<any>}
 */
async function getOrSet(key, ttlSeconds, fetchFn) {
  const cached = store.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }
  const value = await fetchFn();
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  return value;
}

/**
 * Invalidate a specific cache key.
 */
function invalidate(key) {
  store.delete(key);
}

/**
 * Clear all cache entries.
 */
function clear() {
  store.clear();
}

module.exports = { getOrSet, invalidate, clear };
