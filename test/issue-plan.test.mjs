import test from 'node:test';
import assert from 'node:assert/strict';

import { planIssues, splitDuplicates, checkTemplates, duplicateKey } from '../scripts/issue-plan.mjs';
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

test('people holding the badge are set aside; revoked or rejected ones are not', () => {
  const { planned } = planIssues(
    [
      { email: 'pending@x.co', first_name: 'A', last_name: 'B' },
      { email: 'accepted@x.co', first_name: 'A', last_name: 'B' },
      { email: 'revoked@x.co', first_name: 'A', last_name: 'B' },
      { email: 'rejected@x.co', first_name: 'A', last_name: 'B' },
      { email: 'new@x.co', first_name: 'A', last_name: 'B' }
    ],
    { templateId: T, issuedAt: NOW }
  );
  const existing = new Map([
    [duplicateKey('pending@x.co', T), [{ id: 'b1', state: 'pending' }]],
    [duplicateKey('accepted@x.co', T), [{ id: 'b2', state: 'accepted' }]],
    [duplicateKey('revoked@x.co', T), [{ id: 'b3', state: 'revoked' }]],
    [duplicateKey('rejected@x.co', T), [{ id: 'b4', state: 'rejected' }]]
  ]);
  const { toIssue, duplicates } = splitDuplicates(planned, existing);
  assert.deepEqual(toIssue.map((e) => e.payload.recipient_email), ['revoked@x.co', 'rejected@x.co', 'new@x.co']);
  assert.deepEqual(duplicates.map((d) => d.existing.id), ['b1', 'b2']);
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
