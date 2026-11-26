# credjar — working notes

Command-line tooling for the Credly API. The sibling of `syncjar`, which does
the same for Skilljar. The two are laid out alike on purpose, and lessons
learned in one should be carried to the other.

- `docs/api-notes.md`: every endpoint, the permission it needs, and what the
  reference says beyond the endpoint names. Read it before adding a call.
- `docs/plans/`: proposed work. `roadmap.md` lists it in order, with what
  has been done marked as such.

## The documentation site (`docs/`)

`docs/` is a Jekyll site with the Just the Docs theme, published to
<https://westerling.nu/credjar/> by `.github/workflows/docs.yaml`, as
syncjar's is. It deploys from `main` only, because it documents the release
people can install; a docs change reaches the site with the next merge to
`main`. PRs that touch `docs/` build it without deploying.

- **It is public and generic.** Write for anyone with a Credly
  organisation: no organisation's names, ids, template names, counts or
  people. Examples use `example.com` and `courses.example.com`.
- **Link pages with `{{ site.baseurl }}{% link page.md %}`**, not a bare
  path. The tag fails the build on a missing page, which is the only link
  check the site has. GitHub Pages runs Jekyll 3, whose `link` tag does not
  add `baseurl` itself.
- **A command change is a docs change.** New options or behaviour go in the
  command's page and in `docs/reference/commands.md`, in the same PR.
- `docs/plans/` holds working notes and is excluded from the build.

## Branches and versions

`main` is the release branch. `dev` is the integration branch **and the repo
default**. Work flows feature → `dev` → `main`, and PRs base on `dev` unless
the change is a hotfix.

`dev` is the default on purpose. A new PR — and any bot that opens one —
targets the default branch, so making it `dev` means nothing arrives on
`main` un-integrated.

Both branches are protected, with the same settings as syncjar: a PR is
required with no approvals (a single maintainer can't approve their own
PR), CI checks `test (20)` and `test (22)` must pass, no force-pushes, no
deletions, and admins are not exempt. So every change, including docs, goes
through a PR.

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

## CRITICAL: `GET /authorization_tokens` returns every token's secret

Each entry in the response has a `token` field with the credential itself.
A token with delete permission sees every token in the organization.
Printing that response, logging it, writing it to `public/data/`, or
including it in `--json` output leaks every credential the organization
has.

credjar does not call this endpoint, and nothing in the roadmap needs it. If
something ever does, drop `token` from each entry immediately after the
response arrives, before anything else touches it, and add a test in the
style of the redaction tests that fails if a `token` value survives.

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

Reference: <https://docs.credly.com/browse/reference>, with an endpoint map
in `docs/api-notes.md` that also explains how to read it from the command
line.

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

Observed on 2026-10-07, testing the CSV paths:

- **The `issuer_earner_id` rule works:** a new address carrying an
  `issuer_earner_id` already used on a pending badge was skipped. With that,
  all three duplicate rules have been tested against the real API.
- **`badges --csv` feeds `revoke --in` directly,** and already-revoked
  badges in the export are skipped.

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
- `DELETE /badges/{id}` and `POST /badges/{id}/replace` are **not
  implemented** on purpose. `docs/plans/replace-and-delete.md` covers what
  the reference says, what has to be tested in the sandbox first, and the
  design. In short: replace clears every field not sent, and delete gets its
  own token.
- The credjar token should be created **without delete permission**.
  Nothing credjar does needs it.
- `POST /authorization_tokens/rotate` immediately invalidates the token that
  makes the call. Don't call it from here.

## Importing a script must not run it

Entry points (`check`, `list-*`, `issue-badges`, `revoke-badges`,
`create-template`) guard
`main()` with `isMain(import.meta.url)`, and the client is built inside
`main()`, never at module scope. `test/import-without-credentials.test.mjs`
imports every module in a child process with credentials stripped and cwd
moved away from the repo (so `.env` can't mask it), and fails if an import
throws **or prints anything**. Add new modules to its list.

`node --check <file>` for syntax; `npm test` for behaviour.

## The global command

`bin/credjar.mjs` is syncjar's `bin/syncjar.mjs` with the preview commands
taken out; its helpers are in `scripts/cli.mjs` and tested in
`test/cli.test.mjs`. Every `node scripts/….mjs` npm script is a subcommand,
so a new script needs no CLI change, but its file must be under `files` in
`package.json` (a test checks).

- **A packaged install must never be written into.** `credjar update`
  replaces it wholesale. `DATA_DIR` is the clone's `public/data/` from a
  clone (`IS_CHECKOUT`: there is a `.git`) and `<cwd>/public/data/`
  otherwise. Anything new that writes to disk resolves the same way.
- **`update` goes by commit, not version,** since `package.json` lags `dev`.
  It writes `.credjar-install.json` into the install, and refuses a ref
  whose `package.json` has no `bin.credjar`: installing that would remove
  the command. So `credjar update` from `main` works only once a release
  carrying the CLI has merged.

## Data hygiene

- `public/data/` is gitignored (except `.gitkeep`). Exports and audit files
  go there, never to the repo root.
- They contain real names and email addresses. Delete them when done.
- `csvCell()` prefixes `= + - @` with `'` so earner-supplied names can't run
  as spreadsheet formulas.
