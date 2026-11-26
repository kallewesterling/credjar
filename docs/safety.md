---
title: Safety and data handling
nav_order: 8
description: How Credjar previews, confirms and records writes, protects the API token, and handles earner data.
---

# Safety and data handling
{: .no_toc }

1. TOC
{:toc}

---

Credjar issues and revokes credentials in your organisation's name, and both
email real people. This page collects what it does to keep that safe, and
what it expects of you.

## Writes are previewed, confirmed and recorded

- **`--dry-run` is a real preflight.** It makes the same reads as a live
  run: the template checks, the search for people who already hold the
  badge, each badge's current state. What it prints is what the live run
  would do.
- **Everything is decided before the first write.** An invalid row, a
  missing template or an inactive one stops the run before anything is sent,
  so a file is fixed and rerun whole rather than half-issued.
- **You type the environment's name to go ahead,** `sandbox` or
  `production`, not `y`. It can't be done on autopilot, and it makes you
  look at where the command is about to act. Every command prints the
  organisation and environment as its first line for the same reason.
- **`CREDLY_ENV` has no default,** so a missing setting can't mean
  production.
- **Writes run one at a time.** A failure that would hit every row, such as
  an expired token or an outage, stops the run, and the audit file shows
  exactly where.
- **Every live write run leaves an audit CSV,** written even when rows fail.
  For revokes it records each badge's state before the run.

## Retries

Credjar retries a request that was rate-limited, waiting as long as Credly
asks. It retries a server error only when repeating the request is
harmless: reads, and revokes.

**An issue is never retried after a server error.** A 5xx on an issue can
mean the badge was issued and the response lost, and a retry would issue a
second badge and send a second email. The row is recorded as failed, and
the [issue page]({{ site.baseurl }}{% link badges/issuing.md %}#when-something-fails)
says what to check before running again. The same holds for creating a
template.

## Your token

- **It is never printed.** Credly takes the token as an HTTP Basic
  username, so a raw error from the HTTP library would print it in a form
  that's trivial to decode. Every error is stripped of the request's
  headers before it leaves Credjar's API client, and the tests check that it
  is.
- **Create it without delete permission.** Nothing Credjar does needs it;
  see [Configuration]({{ site.baseurl }}{% link configuration.md %}#create-it-with-read-and-write-only).
- **Credjar never lists your organisation's tokens.** Credly's endpoint for
  that returns every token's secret.
- **Credjar never rotates a token.** Credly's rotate endpoint invalidates
  the calling token immediately.

## Earner data

Exports and audit files hold earners' names and email addresses.

- They go to `public/data/`, which a clone's `.gitignore` covers. From the
  global command, that's under the directory you run it from, which may not
  be in a git repository at all, so take care where you run it.
- Delete them when you're done.
- Names in a CSV are written so that a spreadsheet can't run them as
  formulas: a value starting with `=`, `+`, `-` or `@` is prefixed with `'`.

## What Credjar doesn't do

Some of Credly's API is left out on purpose:

- **Deleting badges or templates.** Delete removes a record entirely, and a
  token that can delete can also read every other token's secret.
- **Replacing a badge.** Credly's replace clears every field not sent, which
  is easy to get wrong.
- **Un-revoking.** Credly has no such thing. Restoring a badge means issuing
  a new one, with a new URL and a new email.
