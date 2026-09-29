import test from 'node:test';
import assert from 'node:assert/strict';

import { filterParams, fetchAllPages, fetchOne, PAGE_SIZE } from '../scripts/credly-fetch.mjs';

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

function page(data, current, total) {
  return {
    data,
    metadata: {
      current_page: current,
      total_pages: total,
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
