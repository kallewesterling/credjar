/**
 * revoke-plan.mjs — decides what `npm run revoke` will do, without doing it.
 *
 * The API has a revoke endpoint and no un-revoke one. Putting a person back
 * means issuing them a new badge, which sends a new email and gives the badge
 * a new id and URL, so any link they already shared stops working. So every
 * badge is read before it is revoked, and only badges a person currently
 * holds are sent.
 *
 * Nothing in this module makes a request.
 */
import { HOLDING_STATES } from './issue-plan.mjs';

/**
 * Splits the requested badge ids by what a revoke would do to each.
 *
 * `badges` maps badge id to the badge as read from the API, or to null if
 * the read came back 404. Returns `{ toRevoke, skipped }`; each skipped entry
 * carries the reason.
 */
export function planRevokes(badgeIds, badges) {
  const toRevoke = [];
  const skipped = [];
  const seen = new Set();

  for (const id of badgeIds) {
    if (seen.has(id)) continue;
    seen.add(id);

    const badge = badges.get(id);
    if (!badge) {
      skipped.push({ id, badge: null, reason: 'not found in this organization' });
    } else if (badge.state === 'revoked') {
      skipped.push({ id, badge, reason: 'already revoked' });
    } else if (!HOLDING_STATES.has(badge.state)) {
      skipped.push({ id, badge, reason: `state is ${badge.state}, so there is nothing to revoke` });
    } else {
      toRevoke.push({ id, badge });
    }
  }

  return { toRevoke, skipped };
}

/** Reads badge ids out of input CSV rows, from a `badge_id` or `id` column. */
export function badgeIdsFromRows(rows) {
  const ids = [];
  const missing = [];
  for (const row of rows) {
    const id = row.badge_id || row.id;
    if (id) ids.push(id);
    else missing.push(row._line ?? null);
  }
  return { ids, missing };
}
