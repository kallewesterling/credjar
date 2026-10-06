# credjar — working notes

Command-line tooling for the Credly API. The sibling of `syncjar`, which does
the same for Skilljar. The two are laid out alike on purpose, and lessons
learned in one should be carried to the other.

## Branches and versions

`main` is the release branch. `dev` is the integration branch **and the repo
default**. Work flows feature → `dev` → `main`, and PRs base on `dev` unless
the change is a hotfix.

`dev` is the default on purpose. A new PR — and any bot that opens one —
targets the default branch, so making it `dev` means nothing arrives on
`main` un-integrated.

**A back-merge of `main` into `dev` must be merged with a merge commit, not
squashed.** Squashing breaks `main`'s ancestry of `dev`, and the next release
cannot fast-forward.

**A branch names a role, never a version.** 1.1 is a tag on `main`, not a
`v1.1` branch.

Releases are tags on `main`, cut from a merged `dev`:

```bash
# on main, after dev has merged
git tag -a v0.1.0 -m "credjar 0.1.0" && git push origin v0.1.0
```

At that moment, and not before: promote `## [Unreleased]` in `CHANGELOG.md`
to `## [X.Y.Z] - YYYY-MM-DD` with a fresh `[Unreleased]` above it, and set
`version` in `package.json` to match. `package.json` lags `dev` on purpose.

## CRITICAL: never let a raw axios error reach the console

Credly authenticates with HTTP Basic, the authorization token as username and
a blank password. A raw axios error holds `config.headers.Authorization`, so
an unhandled rejection prints the token in trivially recoverable form. A
token that reaches a terminal, a log, or a CI transcript must be rotated.

Two layers, both required:

1. `redactError()` in `scripts/credly-client.mjs` rebuilds every rejected
   error without `config`, `request` or `response.headers`.
   `test/credly-client.test.mjs` pins this, including a test that the
   unredacted shape *does* leak, so the others can't pass vacuously.
2. Callers still catch. Reads go through `failCleanly()`; writes record
   `describeError(err)` per row. Never print the error object.

Do not weaken `redactError()` for debugging. Add a field to the safe object
and check it cannot carry the header.

## Never retry a POST after a 5xx

`shouldRetry()` retries 429 for any method, but 5xx only for idempotent
methods (GET, PUT, DELETE…). A 5xx on `POST /badges` may mean the badge was
created and the response lost; a retry issues a second badge and sends a
second email to a real person. `test/credly-client.test.mjs` pins it.

Consequence: a 5xx during `issue` is recorded as `failed`, but the badge
**may** exist. Check with `npm run badges -- --email …` before rerunning.
Rerunning is itself safe, since the duplicate check skips people who hold it.

## API paths are relative to the organization

`createCredlyClient()` sets `baseURL` to
`https://{api|sandbox-api}.credly.com/v1/organizations/{CREDLY_ORG_ID}`.
Paths passed to the client are relative to that:

- ✅ `client.get('/badges')`
- ✅ `client.get('')` — the organization itself
- ❌ `client.get('/v1/organizations/{id}/badges')`

Every Credly response is wrapped as `{ data, metadata }`, so an axios
response body is `res.data.data`. Lists page with `page` and `per`; the
metadata carries `total_pages` and `next_page_url`. Default and documented
page size is 50; no maximum is documented, so `PAGE_SIZE` stays at 50.

Filters are `filter[key]=value` (`filterParams()` builds them). The older
`key::value|key::value` syntax is deprecated; don't use it.

Reference: <https://docs.credly.com/browse/reference>. The site is
JavaScript-rendered, but every page has a `.md` twin with the OpenAPI
fragment embedded, which greps well:
`curl -s https://docs.credly.com/browse/reference/post_v1-organizations-organization-id-badges.md`.
Endpoint slugs are listed in the HTML of `/browse/reference`.

## CREDLY_ENV is required, never defaulted

Sandbox and production are different hosts and tokens don't cross. An unset
`CREDLY_ENV` silently meaning production is how a test run issues real
badges, so `readConfig()` refuses to guess. Every command prints the
organization and environment first, and the write confirmation makes the
operator type the environment's name.

`--sandbox` is the other way in, and has the same property. It reads
**only** `CREDLY_SANDBOX_API_TOKEN` and `CREDLY_SANDBOX_ORG_ID` (names in
`SETTING_NAMES`), never their production counterparts, and fixes the host
to the sandbox regardless of any setting. Don't add a fallback from one set
to the other "for convenience": the separation is what lets one `.env` hold
both. `test/credly-client.test.mjs` pins it.

The sandbox is a separate organization that Credly set up on request
(2026-10-05). Observed there on 2026-10-06:

- **Every email goes to the technical contact,** including badge
  notifications and email-address confirmations, so issuing there emails
  no one else. `issue` and `revoke` say so instead of the production
  warning.
- **Accepting a badge needs its address confirmed on the accepting
  account.** Confirming adds the address to that account as a second email,
  which is exactly the setup the "same Credly user" duplicate rule needs:
  issue to `you+test1@…`, accept it as `you@…`, and `you@…` then holds it
  under another address.
- **The exact-email search finds pending badges,** ones no account has
  accepted yet. So `issue`'s `email` search is needed alongside
  `recipient_email_all`, and must not be dropped as redundant.
- **`recipient_email_all` works as documented, and the "same Credly user"
  check is verified live.** A badge to `you+test1@…` was skipped when
  issuing to `you@…`. What links a badge to an account is *confirming its
  address*, not accepting the badge: right after confirmation it still read
  `pending` but already had a `user`, and matched. Before confirmation it
  had `"user": {}` and did not match.

## Writes: what every write command does

Established by syncjar's destructive scripts, and followed here:

- `--dry-run` makes the same reads as a live run and no writes (to Credly or
  disk). A dry run that only echoes its input proves nothing.
- Everything decidable before the first write is decided first, in a pure
  planning module (`issue-plan.mjs`, `revoke-plan.mjs`) that tests cover.
- Typed confirmation (the environment name), skippable only with `--yes`;
  without a TTY and without `--yes`, refuse.
- Writes are sequential. Row-specific failures (400, 404, 422) are recorded
  and the run continues; run-wide ones (401, 403, 429 after retries, 5xx,
  network) stop it — `isRunFatal()`.
- An audit CSV in `public/data/` for every live run, recording prior state.

## Destructive operations

- **There is no un-revoke.** `PUT /badges/{id}/revoke` is final; restoring
  means issuing a new badge (new id, new URL, new email).
- `DELETE /badges/{id}` exists and is **not implemented** here on purpose. It
  removes the record rather than revoking it. If it is ever added, it needs
  the same treatment as revoke, and its own confirmation.
- `POST /badges/{id}/replace` is also not implemented yet.
- `POST /authorization_tokens/rotate` immediately invalidates the token that
  makes the call. Don't call it from here.

## Importing a script must not run it

Entry points (`check`, `list-*`, `issue-badges`, `revoke-badges`) guard
`main()` with `isMain(import.meta.url)`, and the client is built inside
`main()`, never at module scope. `test/import-without-credentials.test.mjs`
imports every module in a child process with credentials stripped and cwd
moved away from the repo (so `.env` can't mask it), and fails if an import
throws **or prints anything**. Add new modules to its list.

`node --check <file>` for syntax; `npm test` for behaviour.

## Data hygiene

- `public/data/` is gitignored (except `.gitkeep`). Exports and audit files
  go there, never to the repo root.
- They contain real names and email addresses. Delete them when done.
- `csvCell()` prefixes `= + - @` with `'` so earner-supplied names can't run
  as spreadsheet formulas.
