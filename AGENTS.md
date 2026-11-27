# AGENTS.md

Usage guide for automated agents — AI or scripted — running credjar.

## What this tool does

credjar issues and revokes Credly badges from the command line. **Issuing
and revoking both email real people, and neither can be undone.** Revoke is
permanent (Credly has no un-revoke; restoring a badge means issuing a new
one, which sends another email). Treat every write as irreversible.

## Environment setup

Required:

| Variable | What it holds |
|---|---|
| `CREDLY_API_TOKEN` | Credly authorization token — read + write, **no delete** |
| `CREDLY_ORG_ID` | Your organization's UUID |
| `CREDLY_ENV` | `production` or `sandbox` — no default; unset is an error |

Sandbox equivalents: `CREDLY_SANDBOX_API_TOKEN`, `CREDLY_SANDBOX_ORG_ID`.
Use `--sandbox` to target the sandbox; it reads only the sandbox settings and
always talks to `sandbox-api.credly.com`.

Tokens are stored in the macOS Keychain by default. Set env vars directly for
headless or agent use.

## Commands at a glance

| Command | Writes to Credly | Emails people |
|---|---|---|
| `npm run check` | No | No |
| `npm run templates` | No | No |
| `npm run badges` | No | No |
| `npm run templates:create` | Yes | No |
| `npm run issue` | Yes | **Yes** |
| `npm run revoke` | Yes | **Yes** |

From a global install: `credjar <command> [options]`.

Every command takes `--sandbox`, `--dry-run`, and `--help`.
Write commands also take `--yes` (skips the typed confirmation).

## Running non-interactively

Write commands ask you to type the environment name (`sandbox` or
`production`) before proceeding. Without a TTY they refuse unless you pass
`--yes`. Add `--yes` for any non-dry-run agent invocation.

## Always dry-run before writing

```bash
npm run issue -- --template TEMPLATE_ID --in people.csv --dry-run
```

Review the plan output — it shows who will be issued a badge, who will be
skipped and why — then run live:

```bash
npm run issue -- --template TEMPLATE_ID --in people.csv --yes
```

The dry run makes all the same reads (template validation, duplicate checks,
badge state lookups). What it prints is what the live run will do. If the
plan is wrong, fix the input and repeat the dry run. Do not proceed to the
live run if the plan is not what you intended.

## Structured output

`badges` and `templates` both support `--json`, which writes the full API
records to stdout as a JSON array. `--csv` writes a file to `public/data/`
instead (or in addition). All other output is human-readable terminal text.

```bash
npm run badges -- --template TEMPLATE_ID --json
npm run templates -- --state active --json
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success — all rows processed, or nothing to do |
| `1` | Error — run-wide failure, or at least one row failed |

`issue` and `revoke` exit `1` even when only some rows failed. Read the
audit CSV at `public/data/credjar-<command>-<timestamp>.csv` to see which
rows succeeded and which did not.

## Safety properties built in

- **Token never printed.** A raw HTTP error would expose the token; credjar
  strips credentials from every error before it surfaces. The tests check
  this.
- **Issue never retried after a 5xx.** A server error on `POST /badges` may
  mean the badge was issued but the response was lost. Retrying could issue
  a second badge and send a second email. The row is recorded as failed.
  Check with `npm run badges -- --email <address>` before rerunning.
- **Duplicate check before every issue.** People who already hold the badge
  are skipped: same email, any secondary email on their Credly profile, or
  the same `issuer_earner_id`. The plan shows which rule matched.
- **Everything decided before the first write.** An invalid row, a missing
  template, or an inactive template stops the run before anything is sent.
  Fix the input and rerun.

## What agents must not do

- **Do not call `GET /authorization_tokens` through any mechanism.** That
  endpoint returns every token's secret in plaintext.
- **Do not pass `--allow-duplicate` without a specific reason.** It bypasses
  the duplicate check and can re-badge people who already hold it.
- **Do not mix environment credentials.** Tokens only work in the environment
  they were issued in. `--sandbox` enforces the separation and cannot be
  overridden.
- **Do not add `delete_enabled` to the credjar token.** Nothing credjar does
  needs delete permission.

## Audit trail

Every live write run leaves a CSV in `public/data/` (gitignored). The file
has one row per input, with the prior badge state (for revoke) and the result.
These files contain earners' names and email addresses — delete them when done.

## Testing

```bash
npm test               # all tests, no credentials needed
npm run check          # live connection check
npm run check -- --sandbox   # sandbox connection check
```

All tests run offline. `test/import-without-credentials.test.mjs` imports
every module with credentials stripped and fails if any module runs code (or
prints anything) on import.
