/**
 * concurrency.mjs — bounded parallelism for reads.
 *
 * The preflight reads before an issue or a revoke are one request per row,
 * and are dominated by round-trip time. Firing them all at once invites a
 * 429, and a throttled burst is slower than a steady stream, so they go out
 * in parallel but bounded. Writes do not use this; they are sequential.
 */

/**
 * Like `items.map(fn)` awaited with `Promise.all`, but with at most `limit`
 * calls to `fn` in flight at once. Results keep input order regardless of
 * completion order.
 *
 * Rejections propagate, as they would from `Promise.all`: these callers decide
 * what to write from the results, so a partial set is not a usable
 * outcome and must not be mistaken for a complete one.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
