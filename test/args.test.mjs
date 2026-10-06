import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTemplateParser } from '../scripts/list-templates.mjs';
import { buildBadgeParser } from '../scripts/list-badges.mjs';
import { buildIssueParser } from '../scripts/issue-badges.mjs';
import { buildRevokeParser } from '../scripts/revoke-badges.mjs';
import { buildCreateTemplateParser } from '../scripts/create-template.mjs';
import { baseParser, isRunFatal } from '../scripts/run.mjs';

/** Parses without yargs printing or exiting, and throws on a usage error. */
function parse(build, args) {
  return build(args)
    .exitProcess(false)
    .fail((msg, err) => {
      throw err ?? new Error(msg);
    })
    .parseSync();
}

const ISSUE_ONE = ['--template', 't', '--email', 'a@b.co', '--first-name', 'A', '--last-name', 'B'];
const REVOKE_ONE = ['--badge', 'b1', '--reason', 'issued in error'];
const CREATE_ONE = ['--file', 't.json'];

test('every command takes --dry-run, and it defaults off', () => {
  const commands = [
    [baseParser, []],
    [buildTemplateParser, []],
    [buildBadgeParser, []],
    [buildIssueParser, ISSUE_ONE],
    [buildRevokeParser, REVOKE_ONE],
    [buildCreateTemplateParser, CREATE_ONE]
  ];
  for (const [build, required] of commands) {
    assert.equal(parse(build, required).dryRun, false);
    assert.equal(parse(build, [...required, '--dry-run']).dryRun, true);
  }
});

test('every command takes --sandbox, and it defaults off', () => {
  const commands = [
    [baseParser, []],
    [buildTemplateParser, []],
    [buildBadgeParser, []],
    [buildIssueParser, ISSUE_ONE],
    [buildRevokeParser, REVOKE_ONE],
    [buildCreateTemplateParser, CREATE_ONE]
  ];
  for (const [build, required] of commands) {
    assert.equal(parse(build, required).sandbox, false);
    assert.equal(parse(build, [...required, '--sandbox']).sandbox, true);
  }
});

// A mistyped --dry-run must not be ignored and turn a preview into a live run.
test('an unknown flag is an error, so a typo cannot drop --dry-run', () => {
  assert.throws(() => parse(buildIssueParser, [...ISSUE_ONE, '--dryrun']), /Unknown argument/);
  assert.throws(() => parse(buildRevokeParser, [...REVOKE_ONE, '--dry']), /Unknown argument/);
});

test('issue needs either a file or one complete recipient', () => {
  assert.throws(() => parse(buildIssueParser, ['--template', 't']), /Pass --in/);
  assert.throws(() => parse(buildIssueParser, ['--email', 'a@b.co']), /needs --first-name/);
  assert.throws(() => parse(buildIssueParser, [...ISSUE_ONE, '--in', 'x.csv']), /not both/);
  assert.throws(() => parse(buildIssueParser, [...ISSUE_ONE, '--issued-at', 'soon']), /not a date/);
  const argv = parse(buildIssueParser, ISSUE_ONE);
  assert.equal(argv.firstName, 'A');
  assert.equal(argv.suppressEmail, false);
  assert.equal(argv.yes, false);
});

test('revoke needs badges and a reason', () => {
  assert.throws(() => parse(buildRevokeParser, ['--reason', 'x']), /--badge/);
  assert.throws(() => parse(buildRevokeParser, ['--badge', 'b1']), /--reason is required/);
  assert.throws(() => parse(buildRevokeParser, ['--badge', 'b1', '--reason', '  ']), /--reason is required/);
  const argv = parse(buildRevokeParser, ['--badge', 'b1', '--badge', 'b2', '--reason', 'x']);
  assert.deepEqual(argv.badge, ['b1', 'b2']);
});

test('only failures that affect every row stop a write run', () => {
  assert.equal(isRunFatal({ response: { status: 422 } }), false);
  assert.equal(isRunFatal({ response: { status: 404 } }), false);
  assert.equal(isRunFatal({ response: { status: 401 } }), true);
  assert.equal(isRunFatal({ response: { status: 403 } }), true);
  assert.equal(isRunFatal({ response: { status: 429 } }), true);
  assert.equal(isRunFatal({ response: { status: 500 } }), true);
  assert.equal(isRunFatal({ code: 'ECONNRESET' }), true);
});
