import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Imports `module` in a child process with no Credly credentials, which is
 * what CI looks like. Returns `{ failure, output }`.
 *
 * A child process, because the parent may already have a .env loaded. The
 * child runs from a temp directory because `dotenv.config()` reads
 * `<cwd>/.env`; running from the repo would load the developer's own token
 * and the test would pass for the very reason it is meant to catch.
 */
function importWithoutCredentials(relativeModule) {
  const env = { ...process.env };
  delete env.CREDLY_API_TOKEN;
  delete env.CREDLY_ORG_ID;
  delete env.CREDLY_ENV;
  delete env.CREDLY_SANDBOX_API_TOKEN;
  delete env.CREDLY_SANDBOX_ORG_ID;
  delete env.CREDLY_SANDBOX_ENV;

  const url = pathToFileURL(path.join(root, relativeModule)).href;
  try {
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`],
      { cwd: os.tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'] }
    ).toString();
    return { failure: null, output };
  } catch (err) {
    return { failure: err.stderr?.toString() || err.message, output: '' };
  }
}

const MODULES = [
  './scripts/credly-client.mjs',
  './scripts/credly-fetch.mjs',
  './scripts/csv.mjs',
  './scripts/issue-plan.mjs',
  './scripts/revoke-plan.mjs',
  './scripts/template-plan.mjs',
  './scripts/run.mjs',
  './scripts/ui.mjs',
  './scripts/concurrency.mjs',
  // The entry points too. Each guards its main() with isMain(), so importing
  // one must neither need credentials nor run the command.
  './scripts/check.mjs',
  './scripts/list-templates.mjs',
  './scripts/list-badges.mjs',
  './scripts/issue-badges.mjs',
  './scripts/revoke-badges.mjs',
  './scripts/create-template.mjs'
];

test('every module loads without Credly credentials, and importing runs nothing', () => {
  for (const mod of MODULES) {
    const { failure, output } = importWithoutCredentials(mod);
    assert.equal(failure, null, `importing ${mod} without credentials failed:\n${failure}`);
    assert.equal(output, '', `importing ${mod} printed output, so it ran something:\n${output}`);
  }
});

// Pins that the check above is not passing because the requirement for a
// token quietly went away.
test('createCredlyClient still refuses to build without a token', () => {
  const { failure } = importWithoutCredentials('./test/fixtures/build-client.mjs');
  assert.ok(failure, 'expected createCredlyClient() to throw without CREDLY_API_TOKEN');
  assert.match(failure, /CREDLY_API_TOKEN is not set/);
});
