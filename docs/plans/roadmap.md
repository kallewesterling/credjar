# Roadmap

Status: ideas, 2026-09-30, updated 2026-10-07. Items that are done say so
under their heading. Every item comes from a
full read of the API reference; the facts behind each one are in
[`../credly-api.md`](../credly-api.md). A larger item gets its own plan, as
[`replace-and-delete.md`](replace-and-delete.md) does.

Roughly in order of value for the risk.

## 1. Fix: the duplicate check only matches on email

**Done** in #2, 2026-10-06. Tested against the sandbox for the same-email
and same-user rules (see `CLAUDE.md`). The `issuer_earner_id` rule is
covered by unit tests only. Kept below as the record of why.

**This is a gap in `issue` as shipped.**

Credly treats a new badge as a duplicate of an existing one from the same
template if any of these is true:

- it has the same `recipient_email`;
- it has the same `issuer_earner_id`;
- it goes to **the same Credly user under a different email**.

credjar's preflight filters `GET /badges` on `recipient_email` and compares
emails, so it catches only the first. The other two get past it:

- **On a template that refuses duplicates** (the default), Credly rejects the
  badge with a 422 because credjar sends `duplicate_behavior: deny`. The run
  records the row as failed. That is safe, but the preflight's "to issue"
  list was wrong.
- **On a template with `allow_duplicate_badges` on**, nothing stops it. The
  person gets a second badge and a second email, which is exactly what the
  preflight is meant to prevent.

The fix:

- Filter on `recipient_email_all` instead of `recipient_email`. This matches
  a user's primary and secondary emails. Check in the sandbox that it
  behaves as documented, and whether it also finds pending badges, which
  have no user account yet.
- When a row has an `issuer_earner_id`, also look up badges with that id
  from the same template.
- A match found through a secondary email or an earner id should be shown
  differently in the plan ("holds this badge under ada.l@…"), so the operator
  can see why it was skipped.
- Tests in `issue-plan.test.mjs` for each of the three kinds.

## 2. Least-privilege token guidance

**Partly done:** `.env-example` says it, for both the production and the
sandbox token. The README doesn't yet.

Tokens have separate read, write and delete flags. Everything credjar does
today needs read and write, and none of it needs delete. So:

- `.env-example` and the README should say to create the credjar token
  **without delete**. Then the worst a bug can do is issue or revoke, which
  are visible and on record, and never delete.
- The delete plan relies on this: it gets its own token
  (`CREDLY_DELETE_TOKEN`).
- OAuth doesn't help here. Its `issued_badges` scope includes delete.

This is only documentation. A code check would mean reading
`GET /authorization_tokens`, which returns every token's secret (see
`CLAUDE.md`), so it isn't worth it.

## 3. `check` finds the organization id

`GET /v1/organizations` lists the organizations the token can see. When
`CREDLY_ORG_ID` is unset or wrong, `check` could list them with their ids,
instead of failing with a 404. Read-only, and it needs a client that isn't
scoped to an organization.

## 4. Richer issuing

`POST /badges` takes more than `issue` sends today:

- **Group tags** (`issuer_earner_groups`, by `external_id` or `name`), for
  example a cohort or event. A `group` CSV column, repeatable or separated
  by semicolons.
- **Evidence**, which can be plain text, a URL, an id, or key/value groups.
  A column per common type (`evidence_url`, `evidence_text`) covers most
  uses. The key/value form probably needs a JSON column.
- `country_name`, `state_or_province` and `locale` as optional columns.
- **Issue from another system's export.** A column mapping
  (`--map email=Email,first_name=First Name`) so syncjar's course
  completion export, or any spreadsheet, can be used without editing.
  Everything after the mapping is the existing flow, and the duplicate check
  is what makes rerunning it safe.

## 5. `npm run events`: what happened since…

`GET /events` lists organization events: `badge.created`,
`badge.state.changed` (accepted or rejected), `badge.deleted`,
`badge.privacy.changed` and template changes. A read-only command answering
"who accepted their badge this week?" or "what changed since the last
issue?" is cheap and useful.

- Needs sandbox checks: whether `/events` takes filters or only pages, and
  how far back it goes. The reference documents only `page`.
- Receiving webhooks would take a public HTTPS server, which is a different
  kind of tool from this one. Out of scope. Webhooks are set up in the UI.

## 6. Faster exports

`GET /high_volume_issued_badge_search` takes the same filters as
`/badges`, sorted by `created_at` with no sort option, and a
`badge_format` including `minimal`. Use it for `badges --csv` once exports
get slow. Measure first: print the request count, as syncjar does. Check its
pagination in the sandbox.

## 7. Replace and delete

See [`replace-and-delete.md`](replace-and-delete.md).

## 8. Badge templates as local files

**Creating is done:** `npm run templates:create`, in #4, 2026-10-06. It was
done before editing, against the order below, because the sandbox started
with no templates and nothing could be issued without one. Pulling and
editing are still to do.

Following syncjar's approach for courses: pull templates to JSON, edit
them, then push with a diff, confirmation and read-back.

- `PUT /badge_templates/{id}` changes only the fields sent, so a push can
  send just the differences. That makes it much safer than replace.
- Creating a template needs an image, three or more skills, an activity and
  a criteria URL. Start with editing and leave creating for later.
- Endorsements (one per organization per template) could come along later.
- `DELETE /badge_templates/{id}` stays out, for the same reasons as badge
  delete.

## Not planned

- **OAuth 2.0.** Its scopes are per resource, not per action. `issued_badges`
  includes delete, so it is coarser than a read-and-write authorization
  token for what credjar does. It would matter only if credjar ran unattended
  and needed short-lived credentials.
- **Token creation and rotation.** Rotation invalidates the calling token
  immediately.
- **Organization profile, issuer authorizations, OAuth applications.**
  These are admin settings, better changed in the UI.
- **Workforce** (`/employees`, skills, invitations) and **recommendations**.
  Only relevant if the organization uses those products.
