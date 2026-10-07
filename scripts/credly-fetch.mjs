/**
 * credly-fetch.mjs — the reads every command is built on.
 *
 * Credly wraps every response as `{ data, metadata }`. List endpoints page
 * with `page` and `per`, and report `total_pages` and `next_page_url` in
 * `metadata`. Filters are `filter[key]=value`; the older `key::value|…`
 * syntax still works but is deprecated, so it is not used here.
 *
 * Every failure exits through failCleanly(). These results feed writes —
 * the duplicate check before an issue, the state check before a revoke — so
 * continuing past a failed page would act on a partial list as if it were
 * complete.
 */
import { failCleanly } from './credly-client.mjs';

// Credly's documented default page size. The API does not document a
// maximum, so this does not ask for more than it is known to give.
export const PAGE_SIZE = 50;

/**
 * Turns `{ state: 'accepted', recipient_email: 'a@b.c' }` into
 * `{ 'filter[state]': 'accepted', 'filter[recipient_email]': 'a@b.c' }`.
 *
 * Done by hand rather than left to axios's nested-object serialiser, so the
 * query string does not depend on an axios default. Empty values are
 * dropped: an empty filter is not the same as no filter to every endpoint.
 */
export function filterParams(filter = {}) {
  const params = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null || value === '') continue;
    params[`filter[${key}]`] = Array.isArray(value) ? value.join(',') : String(value);
  }
  return params;
}

/**
 * Walks a paginated list endpoint and returns every result across all pages.
 * `limit` stops early once that many results are in hand.
 *
 * The returned array also carries two non-enumerable properties, for callers
 * that want to show the walk was complete: `pages`, how many were read, and
 * `reportedTotal`, the `total_count` Credly gave on the first page (or
 * undefined if it gave none). See pagingProblem().
 */
export async function fetchAllPages(client, endpoint, { filter, sort, limit, describe } = {}) {
  const all = [];
  let page = 1;
  let reportedTotal;
  const finish = (result) => {
    Object.defineProperty(result, 'pages', { value: page, enumerable: false });
    Object.defineProperty(result, 'reportedTotal', { value: reportedTotal, enumerable: false });
    return result;
  };

  while (true) {
    let body;
    try {
      ({ data: body } = await client.get(endpoint, {
        params: { ...filterParams(filter), ...(sort ? { sort } : {}), page, per: PAGE_SIZE }
      }));
    } catch (err) {
      failCleanly(err, `${describe ?? `Could not read ${endpoint}`} (page ${page}).`);
    }

    const meta = body.metadata || {};
    if (page === 1 && Number.isFinite(meta.total_count)) reportedTotal = meta.total_count;

    const results = body.data || [];
    all.push(...results);
    if (limit && all.length >= limit) return finish(all.slice(0, limit));

    const more = meta.next_page_url || (meta.total_pages && page < meta.total_pages);
    // An empty page that claims there is more would otherwise loop forever.
    if (!more || !results.length) break;
    page += 1;
  }

  return finish(all);
}

/**
 * A description of what's wrong if a complete walk didn't get as many
 * results as Credly said there were, or null if it did, or if Credly gave no
 * total to compare with. A difference means paging went wrong, or the list
 * changed during the walk, and either way the result is not the full list.
 */
export function pagingProblem(results) {
  const total = results.reportedTotal;
  if (!Number.isFinite(total) || total === results.length) return null;
  return `Credly reported ${total} in total, but ${results.length} were read across ${results.pages} pages`;
}

/**
 * Reads a single resource. Returns null on 404 when `allowMissing` is set,
 * so a caller can say "no such badge" instead of exiting.
 */
export async function fetchOne(client, endpoint, { describe, allowMissing = false } = {}) {
  try {
    const { data: body } = await client.get(endpoint);
    return body.data;
  } catch (err) {
    if (allowMissing && err?.response?.status === 404) return null;
    failCleanly(err, describe ?? `Could not read ${endpoint}.`);
  }
}

/** The organization the token belongs to. Doubles as a credentials check. */
export function fetchOrganization(client) {
  return fetchOne(client, '', { describe: 'Could not read the organization.' });
}

export function fetchBadgeTemplates(client, { filter, sort, limit } = {}) {
  return fetchAllPages(client, '/badge_templates', {
    filter,
    sort,
    limit,
    describe: 'Could not list badge templates'
  });
}

export function fetchBadgeTemplate(client, templateId, { allowMissing = false } = {}) {
  return fetchOne(client, `/badge_templates/${templateId}`, {
    describe: `Could not read badge template ${templateId}.`,
    allowMissing
  });
}

export function fetchIssuedBadges(client, { filter, sort, limit } = {}) {
  return fetchAllPages(client, '/badges', {
    filter,
    sort,
    limit,
    describe: 'Could not list issued badges'
  });
}

export function fetchIssuedBadge(client, badgeId, { allowMissing = false } = {}) {
  return fetchOne(client, `/badges/${badgeId}`, {
    describe: `Could not read badge ${badgeId}.`,
    allowMissing
  });
}
