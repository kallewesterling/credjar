---
title: Configuration
nav_order: 3
---

# Configuration
{: .no_toc }

1. TOC
{:toc}

---

## Where settings are read from

Credjar is configured with environment variables, usually kept in `.env`
files. They are read in this order, and a later one wins over an earlier
one:

1. `~/.config/credjar/.env`. That is `$XDG_CONFIG_HOME/credjar/.env` when
   `XDG_CONFIG_HOME` is set, and `%APPDATA%\credjar\.env` on Windows.
2. The clone's own `.env`, when running from a clone.
3. `.env` in the current directory.
4. Variables already set in your shell, which win over every file.

Each variable is looked up on its own. So keep a token, its organisation ID
and `CREDLY_ENV` together in the same file: a token from one file paired
with an organisation from another fails with a 401 or 403 at best, and is
confusing at worst.

`credjar help` lists the files it reads, in order.

## Settings

| Variable | What it is |
|---|---|
| `CREDLY_API_TOKEN` | An authorization token for your organisation. See below. |
| `CREDLY_ORG_ID` | Your organisation's UUID. |
| `CREDLY_ENV` | `production` or `sandbox`. **Required.** |
| `CREDLY_SANDBOX_API_TOKEN` | Optional. The sandbox's token, used by `--sandbox`. |
| `CREDLY_SANDBOX_ORG_ID` | Optional. The sandbox's organisation UUID, used by `--sandbox`. |

`CREDLY_ENV` has no default. Production and the sandbox are different hosts,
and a missing setting silently meaning production is how a test run issues
real badges, so Credjar refuses to guess.

The sandbox settings are separate so that both environments can live in one
file. `--sandbox` reads only those, never the production ones; see
[The sandbox]({{ site.baseurl }}{% link sandbox.md %}).

## The authorization token

Credly authenticates API calls with an **authorization token**. Create one
in Credly under **Organization Management → Developers → Authorization
Tokens**. The organisation's UUID is shown at the top of any tab in the
Developers section. Tokens expire after 180 days.

### Create it with read and write only

When you add the token, tick **read** and **write**, and leave **delete**
unticked. Do the same for a sandbox token.

Nothing Credjar does needs delete. Issuing and revoking need write, and
both leave a visible record: an issued badge or a revoked one, with its
reason. Delete removes a badge's record entirely. Without delete
permission, no bug in Credjar, or in a script you write against the same
token, can remove a badge.

Credly's OAuth scopes don't help here: the `issued_badges` scope covers
deleting as well as issuing, so a token without delete is the narrowest
credential Credly offers.

| Command | Token permission |
|---|---|
| `check`, `templates`, `badges` | read |
| `templates:create`, `issue`, `revoke` | read and write |

{: .warning }
A token acts for the whole organisation. Treat it like an administrator
password: anyone holding it can issue badges in your organisation's name.

## Keeping the token in a password manager

A `.env` file holds the token in plain text, where any program running as
you can read it, and it's a common way for credentials to leak. Credjar
doesn't need the file: a variable set in the environment wins over every
`.env`, so a password manager can supply the token to one command at a time,
and nothing secret is written to disk.

### 1Password

You need the [1Password CLI](https://developer.1password.com/docs/cli/get-started/)
(`op`), signed in, ideally through the desktop app's integration.

1. Save the token as an item, for example an **API Credential** named
   `Credjar`, with the token as its `credential`. Add a sandbox token as a
   second item, `Credjar sandbox`, if you have one.
2. Write a file of *references* to those items, with the settings that
   aren't secret. It holds no secrets, so it can't leak one:

   ```env
   # ~/.config/credjar/op.env
   CREDLY_API_TOKEN=op://Private/Credjar/credential
   CREDLY_ORG_ID=00000000-0000-0000-0000-000000000000
   CREDLY_ENV=production
   CREDLY_SANDBOX_API_TOKEN=op://Private/Credjar sandbox/credential
   CREDLY_SANDBOX_ORG_ID=00000000-0000-0000-0000-000000000000
   ```

   Use your vault's name in place of `Private`.
3. Run commands through `op run`, which resolves the references, sets the
   variables for that one command, and masks the token in its output:

   ```bash
   op run --env-file ~/.config/credjar/op.env -- credjar check
   ```

To avoid typing that every time, add a function to your `~/.zshrc` or
`~/.bashrc`:

```bash
credjar() { op run --env-file "$HOME/.config/credjar/op.env" -- command credjar "$@"; }
```

### Bitwarden

You need the [Bitwarden CLI](https://bitwarden.com/help/cli/) (`bw`), logged
in with `bw login`.

1. Save the token as a login item named `Credjar`, with the token as its
   password.
2. Add a function to your `~/.zshrc` or `~/.bashrc`. It unlocks the vault
   when needed and sets the token for that one command:

   ```bash
   credjar() {
     if [ -z "$BW_SESSION" ]; then
       BW_SESSION="$(bw unlock --raw)" || return
       export BW_SESSION
     fi
     CREDLY_API_TOKEN="$(bw get password Credjar)" \
       command credjar "$@"
   }
   ```

   Keep `CREDLY_ORG_ID` and `CREDLY_ENV` in `~/.config/credjar/.env`; they
   aren't secret. The vault stays unlocked in that terminal until you run
   `bw lock` or close it. If more than one item is named `Credjar`, `bw get`
   refuses; use the item's id instead.

Either way, `credjar check` shows whether the token arrived.

## Keeping the token safe

- Prefer a password manager (above) to a `.env` file.
- Keep `.env` files out of git. A clone's `.gitignore` already covers `.env`
  and every `.env.*`.
- Make the user-level file readable only by you:
  `chmod 600 ~/.config/credjar/.env`.
- Create tokens without delete permission.
- If a token is ever pasted into a terminal log, a CI transcript or a chat,
  revoke it in Credly and create a new one.
