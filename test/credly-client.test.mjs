import test from 'node:test';
import assert from 'node:assert/strict';

import { redactError, shouldRetry, readConfig, describeError, BASE_URLS } from '../scripts/credly-client.mjs';

const TOKEN = 'notARealCredlyToken123';

// The shape axios rejects with: the request config (including the resolved
// Authorization header), a low-level request object, and the response.
function axiosErrorLike({ method = 'get', status = 404, data = { message: 'Resource not found.' } } = {}) {
  const err = new Error(`Request failed with status code ${status}`);
  err.code = 'ERR_BAD_REQUEST';
  err.isAxiosError = true;
  err.config = {
    method,
    url: '/badges/abc',
    auth: { username: TOKEN, password: '' },
    headers: {
      Authorization: `Basic ${Buffer.from(`${TOKEN}:`).toString('base64')}`,
      Accept: 'application/json'
    }
  };
  err.request = { _header: `GET /v1/x HTTP/1.1\r\nAuthorization: Basic ${TOKEN}\r\n` };
  err.response = {
    status,
    statusText: 'Not Found',
    data,
    headers: { 'content-type': 'application/json' },
    config: err.config,
    request: err.request
  };
  return err;
}

// Everything a serializer might walk, since an unhandled rejection prints the
// object rather than just its message.
function everythingPrintable(value) {
  const seen = new WeakSet();
  const parts = [];
  (function walk(v) {
    if (v === null || v === undefined) return;
    if (typeof v === 'object') {
      if (seen.has(v)) return;
      seen.add(v);
      for (const [k, child] of Object.entries(v)) {
        parts.push(k);
        walk(child);
      }
      return;
    }
    parts.push(String(v));
  })(value);
  if (value instanceof Error) parts.push(value.message, value.stack ?? '');
  return parts.join('\n');
}

const base64Token = Buffer.from(`${TOKEN}:`).toString('base64');

test('a redacted error carries no credentials anywhere in it', () => {
  const printable = everythingPrintable(redactError(axiosErrorLike()));
  assert.ok(!printable.includes(TOKEN), 'the token survived redaction');
  assert.ok(!printable.includes(base64Token), 'the encoded token survived redaction');
  assert.ok(!printable.toLowerCase().includes('authorization'), 'an Authorization header survived redaction');
});

test('the unredacted error really does leak, so the test above means something', () => {
  const printable = everythingPrintable(axiosErrorLike());
  assert.ok(printable.includes(TOKEN));
  assert.ok(printable.includes(base64Token));
});

test('a redacted error keeps what a human needs to act on', () => {
  const safe = redactError(axiosErrorLike());
  assert.equal(safe.message, 'Request failed with status code 404');
  assert.equal(safe.code, 'ERR_BAD_REQUEST');
  assert.equal(safe.method, 'GET');
  assert.equal(safe.url, '/badges/abc');
  assert.equal(safe.response.status, 404);
  assert.deepEqual(safe.response.data, { message: 'Resource not found.' });
  assert.equal(safe.config, undefined);
  assert.equal(safe.request, undefined);
  assert.equal(safe.response.headers, undefined);
});

test('redaction survives an error with no response', () => {
  const err = new Error('getaddrinfo ENOTFOUND api.credly.com');
  err.code = 'ENOTFOUND';
  err.config = { method: 'get', url: '', headers: { Authorization: `Basic ${base64Token}` } };
  const safe = redactError(err);
  assert.equal(safe.response, undefined);
  assert.equal(safe.code, 'ENOTFOUND');
  assert.ok(!everythingPrintable(safe).includes(base64Token));
});

test('a throttled request is retried whatever the method', () => {
  assert.equal(shouldRetry(axiosErrorLike({ method: 'get', status: 429 })), true);
  assert.equal(shouldRetry(axiosErrorLike({ method: 'post', status: 429 })), true);
});

// The one that matters: a 5xx on POST /badges may mean the badge was issued
// and the response lost. Retrying would issue it again and email the person
// twice.
test('a POST is never retried after a server error', () => {
  assert.equal(shouldRetry(axiosErrorLike({ method: 'post', status: 500 })), false);
  assert.equal(shouldRetry(axiosErrorLike({ method: 'post', status: 503 })), false);
});

test('idempotent methods are retried after a server error', () => {
  assert.equal(shouldRetry(axiosErrorLike({ method: 'get', status: 502 })), true);
  assert.equal(shouldRetry(axiosErrorLike({ method: 'put', status: 503 })), true);
});

test('client errors are not retried', () => {
  assert.equal(shouldRetry(axiosErrorLike({ method: 'get', status: 404 })), false);
  assert.equal(shouldRetry(axiosErrorLike({ method: 'post', status: 422 })), false);
});

test('readConfig names whichever setting is missing', () => {
  const full = { CREDLY_API_TOKEN: 't', CREDLY_ORG_ID: 'o', CREDLY_ENV: 'sandbox' };
  assert.throws(() => readConfig({ ...full, CREDLY_API_TOKEN: '' }), /CREDLY_API_TOKEN is not set/);
  assert.throws(() => readConfig({ ...full, CREDLY_ORG_ID: undefined }), /CREDLY_ORG_ID is not set/);
  assert.throws(() => readConfig({ ...full, CREDLY_ENV: undefined }), /CREDLY_ENV is not set/);
});

// Defaulting to production would make a forgotten line in .env the way a
// test run issues real badges.
test('readConfig refuses to guess the environment', () => {
  const base = { CREDLY_API_TOKEN: 't', CREDLY_ORG_ID: 'o' };
  assert.throws(() => readConfig(base), /CREDLY_ENV is not set/);
  assert.throws(() => readConfig({ ...base, CREDLY_ENV: 'prod' }), /must be "production" or "sandbox"/);
});

test('readConfig picks the base URL for the environment', () => {
  const base = { CREDLY_API_TOKEN: 't', CREDLY_ORG_ID: 'o' };
  assert.equal(readConfig({ ...base, CREDLY_ENV: 'sandbox' }).baseURL, BASE_URLS.sandbox);
  assert.equal(readConfig({ ...base, CREDLY_ENV: 'production' }).baseURL, BASE_URLS.production);
  assert.match(BASE_URLS.sandbox, /sandbox-api\.credly\.com/);
});

test('describeError reads both of Credly\'s error shapes', () => {
  assert.equal(describeError(axiosErrorLike()), 'HTTP 404 — Resource not found.');
  const validation = axiosErrorLike({
    status: 422,
    data: { data: { message: 'Validation failed: Email is invalid', errors: [] } }
  });
  assert.equal(describeError(validation), 'HTTP 422 — Validation failed: Email is invalid');
  assert.equal(describeError({ code: 'ECONNRESET' }), 'ECONNRESET');
});
