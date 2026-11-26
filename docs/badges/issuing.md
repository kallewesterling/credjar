---
title: Issue badges
parent: Badges
nav_order: 2
---

# Issuing badges: `issue`
{: .no_toc }

1. TOC
{:toc}

---

{: .warning }
Issuing sends each recipient an email from Credly, and that can't be
unsent. Run with `--dry-run` first, and try anything new in the
[sandbox]({{ site.baseurl }}{% link sandbox.md %}).

## To one person

```bash
credjar issue --template TEMPLATE_ID \
  --email ada@example.com --first-name Ada --last-name Lovelace --dry-run
```

## To a CSV of people

```bash
credjar issue --template TEMPLATE_ID --in people.csv --dry-run
```

The CSV needs `email`, `first_name` and `last_name` columns:

```csv
email,first_name,last_name
ada@example.com,Ada,Lovelace
grace@example.com,Grace,Hopper
```

It can also have these columns, and a value in a row overrides the matching
option:

| Column | Is |
|---|---|
| `template_id` | The template for this row. Rows without one use `--template`. |
| `issued_at` | The date the badge was earned. Default: `--issued-at`, or now. |
| `expires_at` | When the badge expires. |
| `middle_name` | The recipient's middle name. |
| `issuer_earner_id` | Your own id for the person, such as a student number. |

Other columns are ignored, so an export from another system can usually be
used as it is. A path given to `--in` is relative to the directory you run
the command from.

## Options

| Option | Effect |
|---|---|
| `--template <id>` | The template, for rows that don't name one. |
| `--in <file>` | The CSV of recipients. |
| `--email`, `--first-name`, `--last-name` | One recipient, instead of `--in`. |
| `--issued-at <date>` | The date the badge was earned, for rows without one. Default: now. |
| `--suppress-email` | Asks Credly not to email recipients. |
| `--allow-duplicate` | Issues to people who already hold the badge. |
| `--dry-run` | Makes every check and shows the plan, then stops. |
| `--yes` | Skips the typed confirmation, for scripts. |

## What happens before anything is sent

1. **Every row is checked.** If any row is invalid, nothing is sent, and
   every problem is listed with its line number. Fix the file and run it
   again whole.
2. **Every template must exist and be active.**
3. **People who already hold the badge are set aside.** See below.
4. **The plan is shown:** who gets a badge, who is skipped and why, and
   whether Credly will email them. With `--dry-run`, the command stops here.
5. **You type `sandbox` or `production` to continue.** Anything else, and
   nothing is sent. Without a terminal and without `--yes`, the command
   refuses rather than guessing.

Then the badges are issued one at a time, and each result is printed as it
comes back.

## Who already holds the badge

A person holds a badge if they have a `pending` or `accepted` one from the
same template. Credjar looks for that the way Credly decides what a duplicate
is, and a person matches if **any** of these is true:

- a badge was issued to the **same email address**;
- a badge was issued to **another address on the same Credly account**, for
  someone with a work and a personal address on their profile;
- a badge carries the **same `issuer_earner_id`**.

The plan says which rule matched for each person skipped. People whose badge
was revoked or rejected don't hold it, and get a new one.

`--allow-duplicate` issues to everyone anyway, and says how many already
hold it.

## When something fails

A failure that belongs to one row, such as an address Credly rejects, is
recorded, and the run carries on with the next row. A failure that would hit
every row stops the run: an expired token, missing permission, rate limiting
that didn't clear, a server error or a network failure. The rows after it are
recorded as not attempted.

{: .warning }
**After a server error, the badge may have been issued anyway.** A 5xx can
mean Credly issued the badge and the response was lost, so Credjar never
retries an issue; a retry could issue a second badge and send a second
email. Check with `credjar badges --email …` before running again. Running
the same file again is safe: anyone who now holds the badge is skipped.

## The audit file

Every live run writes `public/data/credjar-issue-<timestamp>.csv`, with one
row per recipient: the line it came from, the recipient, the template, the
result (`issued`, `skipped`, `failed` or `not attempted`), the new badge's id
and a detail. It is written even when rows fail. The command exits non-zero
if any row failed.
