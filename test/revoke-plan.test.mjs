import test from 'node:test';
import assert from 'node:assert/strict';

import { planRevokes, badgeIdsFromRows } from '../scripts/revoke-plan.mjs';
import { parseCsv } from '../scripts/csv.mjs';

test('only badges someone currently holds are revoked', () => {
  const badges = new Map([
    ['p', { id: 'p', state: 'pending' }],
    ['a', { id: 'a', state: 'accepted' }],
    ['r', { id: 'r', state: 'revoked' }],
    ['x', { id: 'x', state: 'rejected' }],
    ['s', { id: 's', state: 'replaced' }],
    ['gone', null]
  ]);
  const { toRevoke, skipped } = planRevokes(['p', 'a', 'r', 'x', 's', 'gone'], badges);

  assert.deepEqual(toRevoke.map((t) => t.id), ['p', 'a']);
  assert.deepEqual(
    Object.fromEntries(skipped.map((s) => [s.id, s.reason])),
    {
      r: 'already revoked',
      x: 'state is rejected, so there is nothing to revoke',
      s: 'state is replaced, so there is nothing to revoke',
      gone: 'not found in this organization'
    }
  );
});

test('an id given twice is revoked once', () => {
  const badges = new Map([['a', { id: 'a', state: 'accepted' }]]);
  const { toRevoke } = planRevokes(['a', 'a'], badges);
  assert.equal(toRevoke.length, 1);
});

test('badge ids come from a badge_id or id column', () => {
  assert.deepEqual(badgeIdsFromRows(parseCsv('badge_id,email\nb1,a@b.c\nb2,c@d.e')), { ids: ['b1', 'b2'], missing: [] });
  assert.deepEqual(badgeIdsFromRows(parseCsv('id\nb1')), { ids: ['b1'], missing: [] });
});

test('rows with no badge id are reported by line', () => {
  const { missing } = badgeIdsFromRows(parseCsv('badge_id,email\nb1,a@b.c\n,c@d.e'));
  assert.deepEqual(missing, [3]);
});
