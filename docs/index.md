---
title: Home
layout: home
nav_order: 1
description: Credjar is a command-line tool for inspecting, issuing and revoking Credly badges.
permalink: /
---

# Credjar
{: .fs-9 }

Inspect, issue and revoke [Credly](https://credly.com/) badges from the
command line.
{: .fs-6 .fw-300 }

[Get started]({{ site.baseurl }}{% link getting-started.md %}){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/kallewesterling/credjar){: .btn .fs-5 .mb-4 .mb-md-0 }

---

Credjar works with a Credly organisation's badge templates and issued
badges. It lists them, creates templates from a file, issues badges to one
person or to a CSV of people, and revokes them. It is the Credly counterpart
to [Syncjar](https://westerling.nu/syncjar/), which does the same kind of
work for Skilljar.

This documentation covers **Credjar 0.3.0**.

## What it does

| | |
|---|---|
| **[Templates]({{ site.baseurl }}{% link templates.md %})** | List your badge templates, and create new ones from a JSON file and a PNG. |
| **[List badges]({{ site.baseurl }}{% link badges/listing.md %})** | Find issued badges by template, email, state or date, and export them as CSV. |
| **[Issue]({{ site.baseurl }}{% link badges/issuing.md %})** | Issue a badge to one person, or to everyone in a CSV, skipping people who already hold it. |
| **[Revoke]({{ site.baseurl }}{% link badges/revoking.md %})** | Revoke badges by id, or from a filtered copy of an export. |
| **[Sandbox]({{ site.baseurl }}{% link sandbox.md %})** | Run any command against the Credly sandbox, with its own settings. |

## Built to be hard to misuse

Issuing and revoking both email real people, and neither can be taken back,
so Credjar is cautious by default:

- Every command takes **`--dry-run`**, which makes the same reads as a live
  run and writes nothing. On `issue` and `revoke` that makes it a real
  preflight.
- Everything that can be checked is checked **before the first write**:
  every row of the input, every template, and who already holds the badge.
- Writes ask you to **type the environment's name**, `sandbox` or
  `production`, before they go.
- Every live write run leaves an **audit CSV** with each row's outcome.
- Your API token is **never printed**, not even in a crash.

[Safety and data handling]({{ site.baseurl }}{% link safety.md %}) covers the rest.

## Requirements

- Node.js 20 or later.
- A Credly organisation, and an authorization token for it. See
  [Configuration]({{ site.baseurl }}{% link configuration.md %}#the-authorization-token).
