import test from 'node:test';
import assert from 'node:assert/strict';

import { filterParams, fetchAllPages, fetchOne, pagingProblem, PAGE_SIZE } from '../scripts/credly-fetch.mjs';

/** A stand-in client that serves `pages` in order and records each request. */
function pagedClient(pages) {
  const calls = [];
  return {
    calls,
    async get(endpoint, { params } = {}) {
      calls.push({ endpoint, params });
      const idx = (params?.page ?? 1) - 1;
      return { data: pages[idx] };
    }
  };
}

function page(data, current, total, totalCount) {
  return {
    data,
    metadata: {
      current_page: current,
      total_pages: total,
      ...(totalCount !== undefined ? { total_count: totalCount } : {}),
      next_page_url: current < total ? `https://example/next?page=${current + 1}` : null
    }
  };
}

test('filterParams uses the filter[key] form and drops empty values', () => {
  assert.deepEqual(
    filterParams({ state: 'accepted', recipient_email: 'a@b.c', query: '', user_id: undefined, x: null }),
    { 'filter[state]': 'accepted', 'filter[recipient_email]': 'a@b.c' }
  );
  assert.deepEqual(filterParams({ state: ['pending', 'accepted'] }), { 'filter[state]': 'pending,accepted' });
  assert.deepEqual(filterParams(), {});
});

test('fetchAllPages follows every page', async () => {
  const client = pagedClient([page([1, 2], 1, 3), page([3, 4], 2, 3), page([5], 3, 3)]);
  const all = await fetchAllPages(client, '/badges', { filter: { state: 'accepted' }, sort: '-issued_at' });

  assert.deepEqual(all, [1, 2, 3, 4, 5]);
  assert.deepEqual(client.calls.map((c) => c.params.page), [1, 2, 3]);
  assert.equal(client.calls[0].params['filter[state]'], 'accepted');
  assert.equal(client.calls[0].params.sort, '-issued_at');
  assert.equal(client.calls[0].params.per, PAGE_SIZE);
});

test('fetchAllPages stops once it has the limit', async () => {
  const client = pagedClient([page([1, 2], 1, 3), page([3, 4], 2, 3), page([5], 3, 3)]);
  const some = await fetchAllPages(client, '/badges', { limit: 3 });
  assert.deepEqual(some, [1, 2, 3]);
  assert.equal(client.calls.length, 2);
});

test('fetchAllPages handles a single page with no metadata', async () => {
  const client = pagedClient([{ data: ['only'] }]);
  assert.deepEqual(await fetchAllPages(client, '/badge_templates'), ['only']);
  assert.equal(client.calls.length, 1);
});

test('fetchOne unwraps data, and returns null on 404 when allowed', async () => {
  const found = { get: async () => ({ data: { data: { id: 'b1' }, metadata: {} } }) };
  assert.deepEqual(await fetchOne(found, '/badges/b1'), { id: 'b1' });

  const missing = {
    get: async () => {
      const err = new Error('Not found');
      err.response = { status: 404, data: { message: 'Resource not found.' } };
      throw err;
    }
  };
  assert.equal(await fetchOne(missing, '/badges/nope', { allowMissing: true }), null);
});

test('a full walk records its page count and Credly\'s reported total', async () => {
  const client = pagedClient([page([1, 2], 1, 3, 5), page([3, 4], 2, 3, 5), page([5], 3, 3, 5)]);
  const all = await fetchAllPages(client, '/badges');
  assert.equal(all.pages, 3);
  assert.equal(all.reportedTotal, 5);
  assert.equal(pagingProblem(all), null);
  // Not enumerable, so JSON output and spreading are unaffected.
  assert.deepEqual(Object.keys(all), ['0', '1', '2', '3', '4']);
});

// The point of recording the total: a walk that silently stops early, or
// skips a page, would otherwise look like a complete list.
test('pagingProblem reports a walk that came up short', async () => {
  const client = pagedClient([page([1, 2], 1, 2, 7), page([3], 2, 2, 7)]);
  const all = await fetchAllPages(client, '/badges');
  assert.equal(pagingProblem(all), 'Credly reported 7 in total, but 3 were read across 2 pages');
});

test('pagingProblem stays quiet when Credly gives no total', async () => {
  const client = pagedClient([{ data: ['only'] }]);
  assert.equal(pagingProblem(await fetchAllPages(client, '/badges')), null);
});

test('an empty page that claims there is more ends the walk', async () => {
  const client = pagedClient([page([1], 1, 99, 99), page([], 2, 99, 99), page([2], 3, 99, 99)]);
  const all = await fetchAllPages(client, '/badges');
  assert.deepEqual(all, [1]);
  assert.equal(client.calls.length, 2);
  assert.match(pagingProblem(all), /reported 99/);
});
