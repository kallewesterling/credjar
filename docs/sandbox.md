---
title: The sandbox
nav_order: 4
---

# The sandbox
{: .no_toc }

1. TOC
{:toc}

---

Credly runs a sandbox at [sandbox.credly.com](https://sandbox.credly.com),
with its own API host. It is a separate organisation, with its own login,
token and organisation ID, which Credly sets up on request. Nothing done
there reaches production, and its emails don't reach recipients, so it's the
place to try an issue or a revoke before doing it for real.

## Setting it up

Ask Credly for a sandbox organisation. Once you can sign in to it, create an
authorization token there the same way as in production, with read and
write and no delete (see
[Configuration]({{ site.baseurl }}{% link configuration.md %}#create-it-with-read-and-write-only)),
and add it alongside your production settings:

```env
CREDLY_SANDBOX_API_TOKEN=...
CREDLY_SANDBOX_ORG_ID=...
```

Then check it:

```bash
credjar check --sandbox
```

## `--sandbox`

Every command takes `--sandbox`, which runs it against the sandbox using the
`CREDLY_SANDBOX_*` settings:

```bash
credjar templates --sandbox
credjar issue --sandbox --template TEMPLATE_ID --in people.csv --dry-run
```

- **It never falls back to the production settings.** If a sandbox setting
  is missing, the command stops and says which one.
- **It always talks to the sandbox host,** whatever the settings say. A
  production token in the sandbox settings fails with a 401 and can't reach
  production. If `CREDLY_SANDBOX_ENV` is set to anything other than
  `sandbox`, the command refuses to run.
- **The confirmation asks you to type `sandbox`,** and every command's first
  line says it is running on the sandbox.

You can also point the main settings at the sandbox, with
`CREDLY_ENV=sandbox` and the sandbox's token and ID. `--sandbox` is simpler
when you use both environments, because one file holds both and the flag
picks.

## How the sandbox differs

- **It doesn't email recipients.** It sends every email, including badge
  notifications and address confirmations, to the organisation's technical
  contact, which is set under **Account → Profile** in the sandbox. `issue`
  and `revoke` say so in place of the production warning.
- **To accept a sandbox badge, its address has to be confirmed on your
  account.** Accepting a badge issued to `you+test1@example.com` while
  signed in as `you@example.com` asks you to confirm
  `you+test1@example.com`. The confirmation goes to the technical contact,
  and confirming adds the address to your account as a second email.

That second point is useful for testing how Credjar finds people who already
hold a badge. Issue to `you+test1@example.com`, confirm the address on your
account, then issue the same template to `you@example.com`: Credjar skips
it, because the same Credly user already holds the badge under another
address. See [Issue badges]({{ site.baseurl }}{% link badges/issuing.md %}#who-already-holds-the-badge).

{: .warning }
Credly asks that you don't use real earners' data in the sandbox. Use test
addresses you control, such as `+` aliases of your own.
