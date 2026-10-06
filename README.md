<h1 align="center">Credjar</h1>

<p align="center">
  <strong>Inspect, issue, and revoke Credly badges from the command line.</strong>
</p>

<p align="center">
  The Credly counterpart to <a href="https://github.com/kallewesterling/syncjar">syncjar</a>.
</p>

---

**Credjar** is a small command-line tool for the [Credly](https://credly.com/)
API. It lists your organization's badge templates and issued badges, issues
badges to one person or a CSV of people, and revokes them. Every command
takes `--dry-run`.

Issuing and revoking both email real people, and neither can be taken back,
so both commands check everything they can before the first write, show you
the full plan, and ask you to type the environment's name before they go.

---

## Setup

Requires Node 20 or later.

```bash
git clone https://github.com/kallewesterling/credjar.git
cd credjar
npm install
cp .env-example .env
```

Fill in `.env`:

| Setting | Where to find it |
|---|---|
| `CREDLY_API_TOKEN` | Credly → Organization Management → Developers → Authorization Tokens. Tokens expire after 180 days. |
| `CREDLY_ORG_ID` | The UUID at the top of any tab in the Developers section. |
| `CREDLY_ENV` | `sandbox` or `production`. Required. A token only works in its own environment. |
| `CREDLY_SANDBOX_API_TOKEN`, `CREDLY_SANDBOX_ORG_ID` | Optional. The sandbox's token and organization ID, used by `--sandbox`. See below. |

Then check the connection:

```bash
npm run check
```

## Commands

| Command | What it does | Writes to Credly |
|---|---|---|
| `npm run check` | Confirms the credentials work and shows which organization and environment they point at | No |
| `npm run templates` | Lists badge templates and their ids | No |
| `npm run badges` | Lists issued badges, optionally as CSV | No |
| `npm run issue` | Issues badges | **Yes** |
| `npm run revoke` | Revokes badges | **Yes** |

Pass options after `--`, for example `npm run badges -- --state accepted`.
Every command takes `--help`. In the examples, `TEMPLATE_ID` and `BADGE_ID`
stand for the ids that `npm run templates` and `npm run badges` print.

npm prints each command before running it, and it masks anything shaped
like a UUID as `***` in that line, because old npm access tokens were UUIDs.
So `--template ***` in npm's echo is expected. credjar receives the real id.

### `--sandbox`

Every command takes `--sandbox`, which runs it against the Credly sandbox
(sandbox.credly.com) using the `CREDLY_SANDBOX_*` settings instead:

```bash
npm run check -- --sandbox
npm run issue -- --sandbox --template TEMPLATE_ID --in people.csv --dry-run
```

- **It never falls back to the production settings.** If a sandbox setting
  is missing, the command stops and says which one.
- **It always talks to the sandbox host,** whatever the settings say. A
  production token in the sandbox settings fails with a 401 and can't reach
  production. If `CREDLY_SANDBOX_ENV` is set to anything other than
  `sandbox`, the command refuses to run.
- **The sandbox doesn't email recipients.** It sends every email,
  including badge notifications and address confirmations, to the
  organization's technical contact, which is set under Account → Profile
  in the sandbox.
- **To accept a sandbox badge, its address has to be confirmed on your
  account.** Accepting a badge issued to `you+test1@…` while signed in as
  `you@…` asks you to confirm `you+test1@…`. The confirmation goes to the
  technical contact, and confirming adds the address to your account as a
  second email.

Credly asks that you don't use real earners' data in the sandbox. Use test
addresses you control.

### `--dry-run`

`--dry-run` means the same thing on every command: **reads happen, writes do
not**, neither to Credly nor to disk.

On `issue` and `revoke` a dry run is a real preflight. It checks the
templates, looks up who already holds the badge, and reads each badge's
state, which are the same reads the live run acts on. What it prints is what
the live run would do.

An unknown flag is an error, so a typo such as `--dryrun` stops the command
instead of being ignored.

### List badge templates

```bash
npm run templates
npm run templates -- --state active
npm run templates -- --name "Intro" --csv
```

### List issued badges

```bash
npm run badges -- --template TEMPLATE_ID
npm run badges -- --email ada@example.com
npm run badges -- --state pending,accepted --since 2026-01-01 --csv
```

`--csv` writes to `public/data/`, which is gitignored. The first column is
`badge_id`, so a filtered copy of the file can go straight to `revoke --in`.

### Issue badges

To one person:

```bash
npm run issue -- --template TEMPLATE_ID \
  --email ada@example.com --first-name Ada --last-name Lovelace --dry-run
```

To a CSV of people:

```bash
npm run issue -- --template TEMPLATE_ID --in people.csv --dry-run
```

The CSV needs `email`, `first_name` and `last_name` columns. It can also
include `template_id`, `issued_at`, `expires_at`, `middle_name` and
`issuer_earner_id`. A value in a row overrides the matching flag. Other
columns are ignored.

```csv
email,first_name,last_name
ada@example.com,Ada,Lovelace
grace@example.com,Grace,Hopper
```

Before anything is sent:

1. **Every row is validated.** If any row is invalid, nothing is sent.
   Fix the file and run it again.
2. **Every template must exist and be active.**
3. **People who already hold the badge are skipped.** That means a pending
   or accepted badge from the same template, matched the way Credly matches
   duplicates: the same email, any other email on the person's Credly
   profile, or the same `issuer_earner_id`. The plan says which rule
   matched. People whose badge was revoked or rejected get a new one.
   `--allow-duplicate` overrides this.
4. **The plan is shown.** With `--dry-run`, the command stops here.
5. **You type `sandbox` or `production` to continue.** `--yes` skips this
   step, for scripts.

| Option | Effect |
|---|---|
| `--issued-at <date>` | The date the badge was earned. Default: now. |
| `--suppress-email` | Asks Credly not to email recipients. |
| `--allow-duplicate` | Issues to people who already hold the badge. |
| `--yes` | Skips the typed confirmation. |

### Revoke badges

```bash
npm run revoke -- --badge BADGE_ID --reason "Issued in error" --dry-run
npm run revoke -- --in badges.csv --reason "Issued in error" --dry-run
```

`--reason` is required. Credly records it on the badge and includes it in
the email to the earner, unless you pass `--suppress-email`.

Each badge is read before it is revoked. Only pending or accepted badges are
revoked. Badges that are already revoked, rejected, replaced or not found
are listed and skipped.

**Credly has no un-revoke.** To restore a badge you have to issue a new one.
That sends the earner another email, and the new badge has a new URL.

### Audit files

Each live `issue` or `revoke` run writes
`public/data/credjar-<command>-<timestamp>.csv`. The file has one row per
input, recording what was attempted, the badge's state beforehand (for
revoke), and the result. It is written even when some rows fail.

## Safety

- **Your token is never printed.** Credly authenticates with the token as
  an HTTP Basic username. An unhandled axios error would print that header,
  so every error is stripped of credentials before it leaves the client.
- **An issue is never retried after a server error.** A 5xx on
  `POST /badges` can mean the badge was issued but the response was lost,
  so retrying it could issue a second badge and send a second email. Reads
  and revokes can be repeated safely, so those are retried.
- **Writes run one at a time.** If a failure affects every row (an expired
  token, an outage), the run stops and the audit file shows where.
- **Exports contain names and email addresses.** They go to
  `public/data/`, which is gitignored. Delete them when you are done.

## Development

```bash
npm test
```

Every test runs offline, with no credentials. See `CLAUDE.md` for working
notes and `CHANGELOG.md` for changes.

## Branches

`dev` is the default branch and where work lands. `main` is the release
branch, and releases are tags on `main`. See `CLAUDE.md`.

## License

MIT
