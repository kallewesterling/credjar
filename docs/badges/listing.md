---
title: List badges
parent: Badges
nav_order: 1
description: List issued badges by template, email, state or date, and export them as CSV.
---

# Listing badges: `badges`
{: .no_toc }

1. TOC
{:toc}

---

```bash
credjar badges --template TEMPLATE_ID
credjar badges --email ada@example.com
credjar badges --state pending,accepted --since 2026-01-01 --csv
```

## Options

| Option | Effect |
|---|---|
| `--template <id>` | Only badges from this template. |
| `--email <address>` | Only badges issued to this exact address. |
| `--state <states>` | Only badges in these states, comma-separated: `pending`, `accepted`, `rejected`, `revoked`, `replaced`. |
| `--query <text>` | Partial match on the earner's name or email. |
| `--since <date>` | Issued on or after this date, as `YYYY-MM-DD`. |
| `--until <date>` | Issued on or before this date, as `YYYY-MM-DD`. |
| `--limit <n>` | Stop after this many badges. |
| `--json` | Print the full records as JSON. |
| `--csv` | Also write a CSV to `public/data/`. |

The filters combine: `--template X --state pending` lists the badges from
`X` that no one has accepted yet.

Credjar reads every page of results, and checks that it read as many badges
as Credly reports in total. If not, it warns you, so a partial export can't
pass for a complete one.

## The CSV

`--csv` writes `public/data/credjar-badges-<timestamp>.csv`, with these
columns:

`badge_id`, `state`, `recipient_email`, `first_name`, `last_name`,
`template_id`, `template_name`, `issued_at`, `expires_at`,
`state_updated_at`, `issuer_earner_id`, `revocation_reason`, `badge_url`

The first column is `badge_id`, so a filtered copy of the file can go
straight to [`revoke --in`]({{ site.baseurl }}{% link badges/revoking.md %}).

{: .warning }
The export holds earners' names and email addresses. Delete it when you're
done with it.
