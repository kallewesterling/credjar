---
title: Revoke badges
parent: Badges
nav_order: 3
---

# Revoking badges: `revoke`
{: .no_toc }

1. TOC
{:toc}

---

{: .warning }
**Credly has no un-revoke.** Restoring a revoked badge means issuing a new
one. That sends the earner another email, and the new badge has a new id and
URL, so any link they've already shared stops working.

```bash
credjar revoke --badge BADGE_ID --reason "Issued in error" --dry-run
credjar revoke --in badges.csv --reason "Issued in error" --dry-run
```

## Options

| Option | Effect |
|---|---|
| `--badge <id>` | A badge to revoke. Repeat it for several. |
| `--in <file>` | A CSV with a `badge_id` (or `id`) column. |
| `--reason <text>` | **Required.** Recorded on the badge, and included in the email to the earner. |
| `--suppress-email` | Asks Credly not to email earners. |
| `--dry-run` | Reads every badge and shows the plan, then stops. |
| `--yes` | Skips the typed confirmation, for scripts. |

The CSV that [`badges --csv`]({{ site.baseurl }}{% link badges/listing.md %})
writes has a `badge_id` column, so the usual way to revoke a set of badges
is to export them, delete the rows you want to keep, and pass the rest to
`--in`. An id given twice is revoked once.

## What happens

1. **Every badge is read first.** Only badges someone holds, `pending` or
   `accepted`, are revoked. Badges that are already revoked, rejected,
   replaced or not found are listed and skipped.
2. **The plan is shown,** with each badge's earner and template. With
   `--dry-run`, the command stops here.
3. **You type `sandbox` or `production` to continue.**
4. **Badges are revoked one at a time.** As with `issue`, a failure that
   belongs to one badge is recorded and the run carries on, and one that
   would hit every badge stops it.

Revoking is safe to retry, so a server error is retried, and running the
same file again skips what is already revoked.

## The audit file

Every live run writes `public/data/credjar-revoke-<timestamp>.csv`, with one
row per badge: its id, the earner's email, the template, **its state before
the run**, the result and a detail. The prior state is what lets a mistaken
run be put right badge by badge, by issuing new badges to exactly the people
who lost one.
