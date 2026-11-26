# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are tags on `main`. `dev` is the integration branch; see the branch
and version scheme in `CLAUDE.md`.

## [Unreleased]

## [0.3.1] - 2026-11-26

### Added

- The docs site publishes [`llms.txt`](https://llmstxt.org/), an index for
  LLMs and coding agents, with `llms-full.txt` holding every page and a
  plain-Markdown copy of each page beside its HTML (`issuing.md` beside
  `issuing.html`). Every page now has a `description`.

### Changed

- The README no longer repeats the settings table, the token permissions or
  how to store the token; it links to the Configuration page instead.

## [0.3.0] - 2026-11-26

### Added

- Settings can come from the macOS Keychain. Each `CREDLY_*` setting is
  looked up as a generic password with the service `credjar` and the
  variable's name as the account, only when it isn't set already, so the
  shell and any `.env` still win. `CREDJAR_NO_KEYCHAIN=1` turns it off.

### Changed

- The docs, `credjar help`, `.env-example` and the "not set" errors now
  steer the token to the Keychain or a password manager and away from
  `.env` files.

## [0.2.1] - 2026-11-26

### Added

- A documentation site, built from `docs/` and published to
  <https://westerling.nu/credjar/>: getting started, configuration
  (including keeping the token in a password manager), the sandbox, a page
  per command, a command reference, safety, and the Credly API notes.

### Changed

- `docs/credly-api.md` is now `docs/api-notes.md`, and part of the site.

## [0.2.0] - 2026-11-26

### Added

- A global `credjar` command, installed with
  `npm install --global github:kallewesterling/credjar#main`. Every npm
  script is a subcommand (`credjar issue --dry-run`), and settings are read
  from `.env` in the current directory, then `~/.config/credjar/.env`.
- `credjar update [--ref <ref>] [--force]` reinstalls from GitHub, skipping
  the install when that commit is already the one installed, and refusing a
  ref that doesn't provide the command.

### Changed

- Outside a clone, exports and audit files go to `public/data/` under the
  current directory instead of into the install, which `credjar update`
  replaces.

## [0.1.0] - 2026-10-07

The first release. Tested against the Credly sandbox and, read-only,
against production.

### Added

- `npm run check` confirms the credentials and shows which organization and
  environment they point at.
- `npm run templates` lists badge templates, with `--state`, `--name`,
  `--json` and `--csv`.
- `npm run templates:create` creates a badge template from a JSON file and
  a PNG. It checks Credly's requirements locally, refuses unknown fields and
  duplicate names, and reads the template back to verify it.
- `npm run badges` lists issued badges, filtered by template, email, state
  and issue date, with `--json` and `--csv`. It checks that it read as many
  badges as Credly reports in total, and warns if not.
- `npm run issue` issues badges to one recipient or a CSV of recipients. It
  validates every row and refuses the whole file if any row is invalid,
  checks that templates are active, and asks for typed confirmation before
  sending. Each live run writes an audit CSV.
- `issue` skips people who already hold the badge, by all three of Credly's
  duplicate rules: the same email, any other email on the same Credly
  account, or the same `issuer_earner_id`. It says which rule matched.
- `npm run revoke` revokes badges by id or from a CSV, including the one
  `badges --csv` writes, with a required `--reason`. It reads each badge
  first and revokes only those someone holds. Each live run writes an audit
  CSV.
- `--dry-run` on every command: reads happen, writes don't.
- `--sandbox` on every command runs it against the Credly sandbox, using
  separate `CREDLY_SANDBOX_API_TOKEN` and `CREDLY_SANDBOX_ORG_ID` settings.
  It never falls back to the production settings, and always uses the
  sandbox host.
- An API client that strips credentials from every error, and never retries
  a POST after a server error.
- An offline test suite, and a CI workflow running it on Node 20 and 22.
- `package.json` is marked `private`, so `npm publish` refuses to run, and
  `.gitignore` covers every `.env.*` file.

[Unreleased]: https://github.com/kallewesterling/credjar/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/kallewesterling/credjar/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kallewesterling/credjar/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/kallewesterling/credjar/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kallewesterling/credjar/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kallewesterling/credjar/releases/tag/v0.1.0
