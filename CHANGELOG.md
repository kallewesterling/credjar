# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are tags on `main`. `dev` is the integration branch; see the branch
and version scheme in `CLAUDE.md`.

## [Unreleased]

### Added

- `npm run check` confirms the credentials and shows which organization and
  environment they point at.
- `npm run templates` lists badge templates, with `--state`, `--name`,
  `--json` and `--csv`.
- `npm run badges` lists issued badges, filtered by template, email, state
  and issue date, with `--json` and `--csv`.
- `npm run issue` issues badges to one recipient or a CSV of recipients. It
  validates every row, checks that templates are active, skips people who
  already hold the badge, and asks for typed confirmation before sending.
  Each live run writes an audit CSV.
- `npm run revoke` revokes badges by id or from a CSV, with a required
  `--reason`. It reads each badge first and revokes only those someone
  holds. Each live run writes an audit CSV.
- `--dry-run` on every command: reads happen, writes don't.
- An API client that strips credentials from every error, and never retries
  a POST after a server error.
- Offline test suite and a CI workflow running it on Node 20 and 22.

- `--sandbox` on every command runs it against the Credly sandbox, using
  separate `CREDLY_SANDBOX_API_TOKEN` and `CREDLY_SANDBOX_ORG_ID` settings.
  It never falls back to the production settings, and always uses the
  sandbox host.

- `npm run templates:create` creates a badge template from a JSON file and
  a PNG. It checks Credly's requirements locally, refuses unknown fields and
  duplicate names, and reads the template back to verify it.
- `badges` checks that it read as many badges as Credly reports in total,
  and warns if not, since a short count means the list is incomplete. It
  also shows how many pages it read.
- The README explains why the token should have read and write permission
  only, never delete.

### Changed

- `package.json` is marked `private`, so `npm publish` refuses to run.
- `.gitignore` covers any `.env.*` file, so an extra env file such as
  `.env.sandbox` can't be committed with its token.

### Fixed

- `issue`'s duplicate check compared only the exact email, but Credly also
  counts a badge as a duplicate if it goes to the same Credly user under
  another email, or has the same `issuer_earner_id`. Those people passed
  the preflight. On templates that allow duplicates they got a second badge
  and a second email; on others, Credly's 422 stopped it. The check now
  searches all three ways, says which rule matched, and stops before
  sending anything if Credly's search results can't be trusted. A CSV that
  repeats an `issuer_earner_id` for the same template is also refused.
