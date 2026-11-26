---
title: Badges
nav_order: 6
has_children: true
permalink: /badges/
description: The commands for listing, issuing and revoking badges, and the states a badge can be in.
---

# Badges

Listing, issuing and revoking the badges your organisation has issued.

| Command | Does | Writes to Credly |
|---|---|---|
| [`badges`]({{ site.baseurl }}{% link badges/listing.md %}) | Lists issued badges, filtered, optionally as CSV | no |
| [`issue`]({{ site.baseurl }}{% link badges/issuing.md %}) | Issues badges to one person or a CSV of people | **yes**, emails each recipient |
| [`revoke`]({{ site.baseurl }}{% link badges/revoking.md %}) | Revokes badges by id | **yes**, emails each earner |

A badge is in one of five states:

| State | Meaning |
|---|---|
| `pending` | Issued, not yet accepted by the earner. |
| `accepted` | Accepted by the earner. |
| `rejected` | Rejected by the earner. |
| `revoked` | Revoked by your organisation. The earner no longer sees it. |
| `replaced` | Superseded by a newer badge. |

Credjar treats a `pending` or `accepted` badge as one the person **holds**.
That decides who `issue` skips and what `revoke` acts on.
