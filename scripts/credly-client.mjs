/**
 * credly-client.mjs — the one place that talks to the Credly API.
 *
 * Credly authenticates with HTTP Basic: the organization's authorization token
 * is the username and the password is blank. That is the same shape as
 * Skilljar, and it carries the same hazard, learned the hard way in syncjar:
 * a raw axios error holds `config.headers.Authorization`, which is
 * `Basic <base64 of the token>`, so one unhandled rejection prints the token
 * in trivially recoverable form. A token that reaches a terminal, a log or a
 * CI transcript has to be treated as compromised and rotated.
 *
 * So there are two layers, and both matter:
 *
 * 1. Every rejected error is rebuilt by redactError() before it leaves the
 *    client, so a forgotten try/catch cannot print the token.
 * 2. Callers still catch, and report through failCleanly().
 *
 * Nothing here runs on import, and the client is built only when asked for,
 * so modules that import this one load fine on a machine with no .env.
 */
import axios from 'axios';
import dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config({ quiet: true });

export const BASE_URLS = {
  production: 'https://api.credly.com/v1',
  sandbox: 'https://sandbox-api.credly.com/v1'
};

// How many times to retry a throttled or transiently failing request.
const MAX_RETRIES = 6;

// Fallback backoff (ms) when the server sends no Retry-After header.
// Exponential with a small jitter: ~1s, 2s, 4s, 8s, 16s, 32s (capped).
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60_000;

// Methods that are safe to send twice. PUT /badges/{id}/revoke is included:
// revoking an already-revoked badge changes nothing.
const IDEMPOTENT_METHODS = new Set(['get', 'head', 'options', 'put', 'delete']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.['retry-after'];
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      // A 500ms cushion so we come back after the window has fully closed.
      return seconds * 1000 + 500;
    }
  }
  const expo = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = Math.floor(expo * 0.25 * Math.random());
  return expo + jitter;
}

/**
 * Whether a failed request may be sent again.
 *
 * A 429 means the server refused the request without acting on it, so any
 * method can be retried. A 5xx is different: the server may have done the
 * work and failed afterwards. Retrying `POST /badges` after a 5xx could issue
 * a second badge to a real person, and send them a second email. So a 5xx is
 * retried only for methods where doing it twice is harmless.
 */
export function shouldRetry(error) {
  const status = error.response?.status;
  if (status === 429) return true;
  if (status >= 500 && status < 600) {
    return IDEMPOTENT_METHODS.has(error.config?.method?.toLowerCase());
  }
  return false;
}

/**
 * Rebuilds a rejected axios error without the parts that carry credentials.
 *
 * Keeps what a human needs in order to act: message, code, method, URL,
 * status, body and the original stack. Drops `config`, `request` and
 * `response.headers`. Do not weaken this to pass something through "just
 * for debugging"; add a field to the safe object instead, and check it
 * cannot carry the header.
 */
export function redactError(error) {
  const safe = new Error(error.message);
  safe.stack = error.stack;
  if (error.code !== undefined) safe.code = error.code;
  safe.method = error.config?.method?.toUpperCase();
  safe.url = error.config?.url;
  if (error.response) {
    safe.response = {
      status: error.response.status,
      statusText: error.response.statusText,
      data: error.response.data
    };
  }
  return safe;
}

/**
 * A short, credential-free description of a failed call: status and the
 * message Credly sent back. Credly wraps errors as `{ message }` or, for
 * validation failures, `{ data: { message, errors } }`.
 */
export function describeError(err) {
  const status = err?.response?.status;
  const body = err?.response?.data;
  let detail = '';
  if (typeof body === 'string' && body.length < 300) detail = body;
  else if (body?.data?.message) detail = String(body.data.message);
  else if (body?.message) detail = String(body.message);
  else if (!status) detail = err?.code || err?.message || 'unknown error';
  return status ? `HTTP ${status}${detail ? ` — ${detail}` : ''}` : detail;
}

/**
 * Reports a failed Credly call and exits 1. **Does not return.**
 *
 * Never print the error object itself: status and a short body only.
 */
export function failCleanly(err, context) {
  const status = err?.response?.status;
  console.error(chalk.red(`\n✗ ${context}`));
  console.error(chalk.red(`   ${describeError(err)}`));
  if (status === 401 || status === 403) {
    console.error(chalk.yellow('   Check CREDLY_API_TOKEN and CREDLY_ENV in .env. A sandbox token'));
    console.error(chalk.yellow('   does not work in production, or the other way round.'));
  }
  if (status === 404) {
    console.error(chalk.yellow('   Check CREDLY_ORG_ID in .env, and that it belongs to CREDLY_ENV.'));
  }
  process.exit(1);
}

/**
 * Reads and checks the three settings every command needs. Throws, with a
 * message naming the missing setting, rather than letting a request go out
 * to the wrong place.
 */
export function readConfig(env = process.env) {
  const token = env.CREDLY_API_TOKEN;
  const orgId = env.CREDLY_ORG_ID;
  const environment = env.CREDLY_ENV;

  if (!token) throw new Error('CREDLY_API_TOKEN is not set. Add it to your .env file.');
  if (!orgId) throw new Error('CREDLY_ORG_ID is not set. Add it to your .env file.');
  // Required rather than defaulted: an unset value silently meaning
  // production is how a test run issues real badges.
  if (!environment) {
    throw new Error('CREDLY_ENV is not set. Set it to "production" or "sandbox" in your .env file.');
  }
  if (!BASE_URLS[environment]) {
    throw new Error(`CREDLY_ENV is "${environment}". It must be "production" or "sandbox".`);
  }
  return { token, orgId, environment, baseURL: BASE_URLS[environment] };
}

/**
 * Creates an axios client for the Credly API, scoped to the organization in
 * CREDLY_ORG_ID. Paths are relative to `/v1/organizations/{org_id}`:
 *
 *   client.get('/badges')          ✓
 *   client.get('/v1/…/badges')     ✗ resolves to /v1/organizations/{id}/v1/…
 *
 * The returned client also carries `orgId` and `environment`, so callers can
 * say where they are about to write.
 */
export function createCredlyClient(env = process.env) {
  const { token, orgId, environment, baseURL } = readConfig(env);

  const client = axios.create({
    baseURL: `${baseURL}/organizations/${orgId}`,
    auth: { username: token, password: '' },
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
  });

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      if (!config || !shouldRetry(error)) {
        return Promise.reject(redactError(error));
      }

      config._retryCount = config._retryCount ?? 0;
      if (config._retryCount >= MAX_RETRIES) {
        return Promise.reject(redactError(error));
      }

      const attempt = config._retryCount;
      config._retryCount += 1;
      const delay = retryDelayMs(error.response, attempt);
      const status = error.response?.status;
      const reason = status === 429 ? 'throttled' : `server error ${status}`;

      process.stderr.write(
        chalk.yellow(
          `\nCredly ${reason} on ${config.method?.toUpperCase()} ${config.url} — ` +
            `retrying in ${Math.round(delay / 1000)}s ` +
            `(attempt ${config._retryCount}/${MAX_RETRIES})\n`
        )
      );

      await sleep(delay);
      return client(config);
    }
  );

  client.orgId = orgId;
  client.environment = environment;
  return client;
}
