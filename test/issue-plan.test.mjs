import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planIssues,
  splitDuplicates,
  checkTemplates,
  duplicateKey,
  duplicateSearches,
  findHeld,
  describeDuplicate
} from '../scripts/issue-plan.mjs';
import { parseCsv } from '../scripts/csv.mjs';

const T = 'template-1';
const NOW = '2026-09-30T12:00:00.000Z';

test('a complete row becomes a Credly payload', () => {
  const { planned, invalid } = planIssues(
    [{ email: 'ada@example.com', first_name: 'Ada', last_name: 'Lovelace' }],
    { templateId: T, issuedAt: NOW }
  );
  assert.deepEqual(invalid, []);
  assert.deepEqual(planned[0].payload, {
    recipient_email: 'ada@example.com',
    issued_to_first_name: 'Ada',
    issued_to_last_name: 'Lovelace',
    badge_template_id: T,
    issued_at: NOW
  });
});

test('per-row template and date win over the defaults', () => {
  const { planned } = planIssues(
    [{ email: 'a@b.co', first_name: 'A', last_name: 'B', template_id: 'other', issued_at: '2026-01-01' }],
    { templateId: T, issuedAt: NOW }
  );
  assert.equal(planned[0].payload.badge_template_id, 'other');
  assert.equal(planned[0].payload.issued_at, '2026-01-01');
});

test('unknown columns are ignored, not sent', () => {
  const { planned } = planIssues(
    [{ email: 'a@b.co', first_name: 'A', last_name: 'B', notes: 'VIP', admin: 'true' }],
    { templateId: T, issuedAt: NOW }
  );
  assert.deepEqual(Object.keys(planned[0].payload).sort(), [
    'badge_template_id',
    'issued_at',
    'issued_to_first_name',
    'issued_to_last_name',
    'recipient_email'
  ]);
});

test('--suppress-email is carried into every payload', () => {
  const { planned } = planIssues([{ email: 'a@b.co', first_name: 'A', last_name: 'B' }], {
    templateId: T,
    issuedAt: NOW,
    suppressEmail: true
  });
  assert.equal(planned[0].payload.suppress_badge_notification_email, true);
});

test('every problem with a row is reported, with its line', () => {
  const rows = parseCsv('email,first_name,last_name,issued_at\nnot-an-email,,Lovelace,yesterday\n');
  const { planned, invalid } = planIssues(rows, {});
  assert.equal(planned.length, 0);
  assert.equal(invalid[0].line, 2);
  const reasons = invalid[0].reasons.join('\n');
  assert.match(reasons, /missing first_name/);
  assert.match(reasons, /missing template_id/);
  assert.match(reasons, /does not look like an email/);
  assert.match(reasons, /issued_at "yesterday" is not a date/);
});

test('the same person and badge twice in one file is caught, case-insensitively', () => {
  const rows = parseCsv('email,first_name,last_name\nAda@Example.com,Ada,L\nada@example.com,Ada,L\n');
  const { planned, invalid } = planIssues(rows, { templateId: T, issuedAt: NOW });
  assert.equal(planned.length, 1);
  assert.match(invalid[0].reasons[0], /same person and badge as the row on line 2/);
});

test('the same person with two different badges is fine', () => {
  const { planned, invalid } = planIssues(
    [
      { email: 'a@b.co', first_name: 'A', last_name: 'B', template_id: 't1' },
      { email: 'a@b.co', first_name: 'A', last_name: 'B', template_id: 't2' }
    ],
    { issuedAt: NOW }
  );
  assert.equal(planned.length, 2);
  assert.equal(invalid.length, 0);
});

test('the same issuer_earner_id twice in one file is caught', () => {
  const { planned, invalid } = planIssues(
    [
      { email: 'a@x.co', first_name: 'A', last_name: 'B', issuer_earner_id: 'E1' },
      { email: 'other@x.co', first_name: 'A', last_name: 'B', issuer_earner_id: 'E1' }
    ],
    { templateId: T, issuedAt: NOW }
  );
  assert.equal(planned.length, 1);
  assert.match(invalid[0].reasons[0], /same person and badge as the row/);
});

// A badge as the API returns it, cut down to what the duplicate check reads.
function badge(id, { email, state = 'accepted', template = T, user = null, earner = null }) {
  return { id, state, recipient_email: email, badge_template: { id: template }, user: user && { id: user }, issuer_earner_id: earner };
}

const ADA = { recipient_email: 'ada@example.com', badge_template_id: T };

test('duplicateSearches covers email, the whole profile, and earner id when given', () => {
  assert.deepEqual(duplicateSearches(ADA).map((s) => s.kind), ['email', 'same_user']);
  const withEarner = duplicateSearches({ ...ADA, issuer_earner_id: 'E1' });
  assert.deepEqual(withEarner.map((s) => s.kind), ['email', 'same_user', 'issuer_earner_id']);
  assert.deepEqual(withEarner[1].filter, { badge_template_id: T, recipient_email_all: 'ada@example.com' });
  assert.deepEqual(withEarner[2].filter, { badge_template_id: T, issuer_earner_id: 'E1' });
  for (const s of withEarner) assert.equal(s.filter.badge_template_id, T);
});

test('a badge under the same email is held, case-insensitively', () => {
  const { held, problem } = findHeld(ADA, [
    { kind: 'email', badges: [badge('b1', { email: 'Ada@Example.com', state: 'pending' })] },
    { kind: 'same_user', badges: [] }
  ]);
  assert.equal(problem, null);
  assert.deepEqual([held.badge.id, held.match], ['b1', 'email']);
});

// The gap this fixes: the old check compared emails, so this person got
// past it and, on a template allowing duplicates, got a second badge.
test('a badge held by the same user under another email is held', () => {
  const { held } = findHeld(ADA, [
    { kind: 'email', badges: [] },
    { kind: 'same_user', badges: [badge('b2', { email: 'ada.l@work.example', user: 'u1' })] }
  ]);
  assert.deepEqual([held.badge.id, held.match], ['b2', 'same_user']);
  assert.match(describeDuplicate({ existing: held.badge, match: held.match }), /same Credly user as the badge issued to ada\.l@work\.example/);
});

test('a badge with the same issuer_earner_id is held', () => {
  const payload = { ...ADA, issuer_earner_id: 'E1' };
  const { held } = findHeld(payload, [
    { kind: 'email', badges: [] },
    { kind: 'same_user', badges: [] },
    { kind: 'issuer_earner_id', badges: [badge('b3', { email: 'someone@else.example', earner: 'E1' })] }
  ]);
  assert.deepEqual([held.badge.id, held.match], ['b3', 'issuer_earner_id']);
});

test('the most recognisable match is reported when several searches find one', () => {
  const same = badge('b1', { email: 'ada@example.com', user: 'u1' });
  const { held } = findHeld(ADA, [
    { kind: 'same_user', badges: [badge('b2', { email: 'ada.l@work.example', user: 'u1' }), same] },
    { kind: 'email', badges: [same] }
  ]);
  assert.deepEqual([held.badge.id, held.match], ['b1', 'email']);
});

test('revoked, rejected and replaced badges do not count', () => {
  const { held } = findHeld(ADA, [
    {
      kind: 'email',
      badges: ['revoked', 'rejected', 'replaced'].map((state, i) => badge(`b${i}`, { email: 'ada@example.com', state }))
    },
    { kind: 'same_user', badges: [badge('b9', { email: 'ada.l@work.example', user: 'u1', state: 'revoked' })] }
  ]);
  assert.equal(held, null);
});

// Filters are not taken on faith: a search that ignored its filter would
// otherwise make everyone look like a holder, or no one.
test('results that do not match the search are dropped', () => {
  const { held } = findHeld({ ...ADA, issuer_earner_id: 'E1' }, [
    { kind: 'email', badges: [badge('b1', { email: 'grace@example.com' })] },
    { kind: 'same_user', badges: [badge('b2', { email: 'ada@example.com', template: 'other-template', user: 'u1' })] },
    { kind: 'issuer_earner_id', badges: [badge('b3', { email: 'x@example.com', earner: 'E2' })] }
  ]);
  assert.equal(held, null);
});

test('a profile search spanning several users stops the run instead of guessing', () => {
  const { held, problem } = findHeld(ADA, [
    { kind: 'email', badges: [] },
    {
      kind: 'same_user',
      badges: [badge('b1', { email: 'a@x.co', user: 'u1' }), badge('b2', { email: 'b@x.co', user: 'u2' })]
    }
  ]);
  assert.equal(held, null);
  assert.match(problem, /2 different users/);
});

test('people holding the badge are set aside, the rest are issued', () => {
  const { planned } = planIssues(
    [
      { email: 'held@x.co', first_name: 'A', last_name: 'B' },
      { email: 'new@x.co', first_name: 'A', last_name: 'B' }
    ],
    { templateId: T, issuedAt: NOW }
  );
  const held = new Map([
    [duplicateKey('held@x.co', T), { badge: badge('b1', { email: 'held@x.co' }), match: 'email' }],
    [duplicateKey('new@x.co', T), null]
  ]);
  const { toIssue, duplicates } = splitDuplicates(planned, held);
  assert.deepEqual(toIssue.map((e) => e.payload.recipient_email), ['new@x.co']);
  assert.deepEqual(duplicates.map((d) => [d.existing.id, d.match]), [['b1', 'email']]);
  assert.equal(describeDuplicate(duplicates[0]), 'already holds it (accepted, b1)');
});

test('templates must exist and be active', () => {
  const templates = new Map([
    ['ok', { name: 'Good', state: 'active' }],
    ['draft', { name: 'WIP', state: 'draft' }],
    ['gone', null]
  ]);
  assert.deepEqual(checkTemplates(['ok'], templates), []);
  const problems = checkTemplates(['ok', 'draft', 'gone'], templates);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /"WIP" \(draft\) is draft, not active/);
  assert.match(problems[1], /gone does not exist/);
});
