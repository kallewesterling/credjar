/**
 * keychain.mjs — Credly settings from the macOS Keychain, so the token need
 * not sit in a `.env` file. The same design as syncjar's.
 *
 * Each setting is a generic password whose service is `credjar` and whose
 * account is the variable's name. `-w` last makes `security` prompt for the
 * value, so it never reaches the shell history:
 *
 *   security add-generic-password -U -s credjar -a CREDLY_API_TOKEN -w
 *
 * The Keychain only fills variables that are not set already, so a variable
 * in the shell or a `.env` file still wins. Nothing is read on import:
 * `security` runs when the settings are read, and only on macOS.
 */
import { execFileSync } from 'child_process';

export const KEYCHAIN_SERVICE = 'credjar';

// Every setting, not just the tokens: each one is looked up on its own, and a
// token from the Keychain paired with an organization from a .env is how a
// request reaches the wrong place. Storing all of them lets the .env go.
export const KEYCHAIN_NAMES = [
  'CREDLY_API_TOKEN',
  'CREDLY_ORG_ID',
  'CREDLY_ENV',
  'CREDLY_SANDBOX_API_TOKEN',
  'CREDLY_SANDBOX_ORG_ID',
  'CREDLY_SANDBOX_ENV'
];

/** Set to anything to keep the Keychain out of it, as the tests do. */
export const KEYCHAIN_OPT_OUT = 'CREDJAR_NO_KEYCHAIN';

// An absolute path, so a `security` earlier on PATH never sees the request.
const SECURITY = '/usr/bin/security';

/**
 * The value stored for `account`, or undefined when there is none, the
 * Keychain stayed locked, or this is not macOS. The value comes back over a
 * pipe and is never printed. `security`'s stderr is discarded as well.
 */
export function readKeychain(account, { service = KEYCHAIN_SERVICE, platform = process.platform, run = execFileSync } = {}) {
  if (platform !== 'darwin') return undefined;
  try {
    const out = run(SECURITY, ['find-generic-password', '-s', service, '-a', account, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000
    });
    return out.replace(/\r?\n$/, '') || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fills each of `names` that `env` lacks from the Keychain, in place, and
 * returns `env`. Does nothing when CREDJAR_NO_KEYCHAIN is set.
 */
export function withKeychain(env = process.env, { names = KEYCHAIN_NAMES, ...options } = {}) {
  if (env[KEYCHAIN_OPT_OUT]) return env;
  for (const name of names) {
    if (env[name]) continue;
    const value = readKeychain(name, options);
    if (value) env[name] = value;
  }
  return env;
}
