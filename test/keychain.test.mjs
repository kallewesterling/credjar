import test from 'node:test';
import assert from 'node:assert/strict';

import { KEYCHAIN_NAMES, readKeychain, withKeychain } from '../scripts/keychain.mjs';
import { SETTING_NAMES } from '../scripts/credly-client.mjs';

/** A stand-in for execFileSync that answers from `store`, recording each call. */
function fakeSecurity(store) {
  const calls = [];
  const run = (file, args) => {
    calls.push({ file, args });
    const account = args[args.indexOf('-a') + 1];
    if (!(account in store)) throw new Error('The specified item could not be found in the keychain.');
    return `${store[account]}\n`;
  };
  return { run, calls };
}

test('readKeychain asks /usr/bin/security for the credjar item and trims the newline', () => {
  const { run, calls } = fakeSecurity({ CREDLY_API_TOKEN: 't' });
  assert.equal(readKeychain('CREDLY_API_TOKEN', { platform: 'darwin', run }), 't');
  assert.deepEqual(calls, [{
    file: '/usr/bin/security',
    args: ['find-generic-password', '-s', 'credjar', '-a', 'CREDLY_API_TOKEN', '-w']
  }]);
});

test('readKeychain is undefined for a missing item, and never runs off macOS', () => {
  const { run, calls } = fakeSecurity({});
  assert.equal(readKeychain('CREDLY_API_TOKEN', { platform: 'darwin', run }), undefined);
  assert.equal(readKeychain('CREDLY_API_TOKEN', { platform: 'linux', run }), undefined);
  assert.equal(calls.length, 1);
});

test('the Keychain covers every setting readConfig reads', () => {
  const read = Object.values(SETTING_NAMES).flatMap((names) => Object.values(names));
  assert.deepEqual([...read].sort(), [...KEYCHAIN_NAMES].sort());
});

test('withKeychain fills only what is unset, so the environment wins', () => {
  const { run } = fakeSecurity({ CREDLY_API_TOKEN: 'from-keychain', CREDLY_ORG_ID: 'org' });
  const env = { CREDLY_API_TOKEN: 'from-shell' };
  assert.equal(withKeychain(env, { platform: 'darwin', run }), env);
  assert.deepEqual(env, { CREDLY_API_TOKEN: 'from-shell', CREDLY_ORG_ID: 'org' });
});

test('CREDJAR_NO_KEYCHAIN keeps the Keychain out entirely', () => {
  const { run, calls } = fakeSecurity({ CREDLY_API_TOKEN: 't' });
  const env = { CREDJAR_NO_KEYCHAIN: '1' };
  withKeychain(env, { platform: 'darwin', run });
  assert.deepEqual(env, { CREDJAR_NO_KEYCHAIN: '1' });
  assert.equal(calls.length, 0);
});
