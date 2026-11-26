---
title: Command reference
nav_order: 7
permalink: /reference/commands/
---

# Command reference
{: .no_toc }

Every command, what it needs, and where it's documented. Run
`credjar <command> --help` for its full list of options. From a clone, the
same command is `npm run <command> -- <options>`.

1. TOC
{:toc}

---

## Commands

| Command | Does | Writes to Credly | Token |
|---|---|---|---|
| [`check`]({{ site.baseurl }}{% link getting-started.md %}#check-the-connection) | Confirms the settings work, and shows the organisation and environment | no | read |
| [`templates`]({{ site.baseurl }}{% link templates.md %}#listing-templates-templates) | Lists badge templates and their ids | no | read |
| [`templates:create`]({{ site.baseurl }}{% link templates.md %}#creating-a-template-templatescreate) | Creates a badge template from a JSON file and a PNG | **yes** | read, write |
| [`badges`]({{ site.baseurl }}{% link badges/listing.md %}) | Lists issued badges, optionally as CSV | no | read |
| [`issue`]({{ site.baseurl }}{% link badges/issuing.md %}) | Issues badges to one person or a CSV of people | **yes** | read, write |
| [`revoke`]({{ site.baseurl }}{% link badges/revoking.md %}) | Revokes badges by id | **yes** | read, write |

## The `credjar` command itself

| Command | Does |
|---|---|
| `credjar help` | Lists the commands, the installed version and commit, and where settings are read from. |
| `credjar --version` | Prints the version. |
| [`credjar update`]({{ site.baseurl }}{% link getting-started.md %}#updating) | Installs the latest release from GitHub, unless it's already installed. `--ref` picks a tag, branch or commit; `--force` reinstalls. |

## Options every command takes

| Option | Effect |
|---|---|
| `--sandbox` | Runs against the [Credly sandbox]({{ site.baseurl }}{% link sandbox.md %}), with the `CREDLY_SANDBOX_*` settings. |
| `--dry-run` | Makes the same reads as a live run, and writes nothing, to Credly or to disk. |
| `--help` | Lists the command's options. |

An unknown option is an error, so a typo such as `--dryrun` stops the
command instead of being ignored.

The commands that write also take `--yes`, which skips the typed
confirmation. Without a terminal and without `--yes`, they refuse.

## Exit codes

Every command exits `0` on success and `1` when it stops on an error. `issue`
and `revoke` also exit `1` if any row failed, even though the run carried on
past it; the audit file says which.

## Files

| File | Written by |
|---|---|
| `public/data/credjar-templates-<timestamp>.csv` | `templates --csv` |
| `public/data/credjar-badges-<timestamp>.csv` | `badges --csv` |
| `public/data/credjar-create-template-<timestamp>.csv` | every live `templates:create` |
| `public/data/credjar-issue-<timestamp>.csv` | every live `issue` |
| `public/data/credjar-revoke-<timestamp>.csv` | every live `revoke` |

`public/data/` is in the clone when running from one, and under the current
directory otherwise. See
[Where files are written]({{ site.baseurl }}{% link getting-started.md %}#where-files-are-written).
