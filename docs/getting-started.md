---
title: Getting started
nav_order: 2
---

# Getting started
{: .no_toc }

1. TOC
{:toc}

---

There are two ways to run Credjar:

- **As a global `credjar` command**, installed with npm. This is the one to
  use if you just want to run the commands.
- **From a clone of the repository**, with `npm run`. Use this if you want
  to change Credjar itself.

Both run the same commands with the same options: `credjar issue --dry-run`
and `npm run issue -- --dry-run` are the same thing.

## Install the `credjar` command

You need Node.js 20 or later.

```bash
npm install --global github:kallewesterling/credjar#main
```

`main` holds the latest release. To pin one, name its tag instead, for
example `#v0.3.0`. Then check it works:

```bash
credjar help       # every command, and where settings are read from
credjar --version
```

### Updating

```bash
credjar update                  # the latest release
credjar update --ref v0.3.0     # a specific tag, branch or commit
credjar update --force          # reinstall even if it's already installed
```

`credjar update` looks up the commit the ref points at, and does nothing if
that commit is already installed. It checks the commit, not the version
number, because a branch keeps the same version number from one commit to
the next.

npm doesn't record which commit it installed, so the first update after
installing with `npm install --global` always reinstalls. After that,
`update` keeps its own record, and `credjar help` shows the ref and commit
you're on.

Before installing, `update` also checks that the ref provides the `credjar`
command. Refs from before 0.2.0 don't, and installing one would remove the
command, leaving you no `credjar update` to recover with.

## Or work from a clone

```bash
git clone https://github.com/kallewesterling/credjar.git
cd credjar
npm install
```

Run commands as `npm run <command>`, with options after `--`:

```bash
npm run issue -- --dry-run
```

Update a clone with `git pull`. `credjar update` refuses to run from one.

{: .note }
npm prints each command before running it, and masks anything shaped like a
UUID as `***` in that line. So `--template ***` in npm's echo is expected;
Credjar receives the real id. The global command doesn't do this.

## Add your settings

Credjar needs three settings:

```env
CREDLY_API_TOKEN=...
CREDLY_ORG_ID=...
CREDLY_ENV=production
```

[Configuration]({{ site.baseurl }}{% link configuration.md %}) explains where
to find each one, and how to create the token so that it **can't delete
anything**. Do that before you create it.

Don't put them in a `.env` file. On a Mac, store them in the Keychain, where
Credjar finds them by itself. Each command prompts for the value:

```bash
security add-generic-password -U -s credjar -a CREDLY_API_TOKEN -w
security add-generic-password -U -s credjar -a CREDLY_ORG_ID -w
security add-generic-password -U -s credjar -a CREDLY_ENV -w
```

Elsewhere, or for a prompt on every use, have a password manager such as
1Password supply the token to each command; see
[Keeping the token in a password manager]({{ site.baseurl }}{% link configuration.md %}#keeping-the-token-in-a-password-manager).
`.env` files still work, but hold the token in plain text where any program
running as you can read it.

## Check the connection

```bash
credjar check
```

It prints the organisation and environment the settings point at, and
confirms it can read badge templates. Every other command prints the same
line first, so you always know where a command is about to act.

`check` only proves read access. A token without write permission passes
it, and fails later on `issue` or `revoke` with HTTP 403.

## Your first badge, in the sandbox

Credly offers a sandbox: a separate organisation on a separate host, where
every email goes to you rather than to the recipient. It is the place to try
an issue before doing it for real. Set it up as described in
[The sandbox]({{ site.baseurl }}{% link sandbox.md %}), then:

```bash
credjar templates --sandbox --state active
```

Pick a template id from the list, and preview issuing it to yourself:

```bash
credjar issue --sandbox --template TEMPLATE_ID \
  --email you@example.com --first-name Ada --last-name Lovelace --dry-run
```

The dry run checks the template, looks up whether you already hold the
badge, and prints what it would send. Run it again without `--dry-run`, type
`sandbox` when asked, and the badge is issued. Then look it up:

```bash
credjar badges --sandbox --email you@example.com
```

## Where files are written

Exports and audit files go to `public/data/`:

- **From a clone**, that's `public/data/` inside the clone, which is
  gitignored.
- **From the global command**, it's `public/data/` under **the directory you
  run the command from**. It never goes inside the installation, because the
  next `credjar update` replaces it.

These files hold earners' names and email addresses; see
[Safety and data handling]({{ site.baseurl }}{% link safety.md %}#earner-data).
