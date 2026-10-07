# Plan: replace and delete issued badges

Status: proposal, 2026-09-30. Not started. The sandbox the experiments
need exists as of 2026-10-05: run any command with `--sandbox`.

credjar can issue and revoke. The API also has two more ways to change an
issued badge, and credjar leaves both out on purpose for now:

| Endpoint | What it does |
|---|---|
| `POST /badges/{id}/replace` | Creates a new badge to take the place of an existing one |
| `DELETE /badges/{id}` | Deletes an issued badge |

This plan covers what each is for, what the API reference says about it, what
still has to be tested in the sandbox, and how each command should behave.
The API facts it relies on are collected in [`../credly-api.md`](../credly-api.md).

## Why they are not in 0.x

Revoke is final, but it is visible. The badge stays on record as revoked, with
a reason, and the earner is told. Replace and delete both change the record in
ways that are harder to see afterwards, and the reference leaves out details
that decide whether they are safe to automate. Each needs sandbox testing
before it can be built on, as syncjar's quiz writes did (see syncjar's
`CLAUDE.md`, "Quiz writes: what the API does, as opposed to what the spec
says").

## Replace

### What it is for

- Correcting a misspelt earner name on a badge that has already been accepted.
- Moving a badge to a new version of its template.
- Correcting the recipient email on a badge that is still pending.
- Changing `issued_at` or `expires_at` without revoking and reissuing, which
  would send the earner a revocation email.

### What the reference says

- **Fields you leave out are not copied from the old badge.** The replacement
  gets `null` for any field the request doesn't include, even when the
  original had a value. The only exception listed is `recipient_email`, which
  is copied when left out.
- **Required fields:** `badge_template_id`, `issued_at`,
  `issued_to_first_name` and `issued_to_last_name`. This means a replace has
  to send the whole badge again, not just the fields that change.
- **`recipient_email` can only change while the badge is `pending`.** For any
  other state the API returns 422: "Recipient Email replacement is only
  allowed on pending badges."
- **A badge can be replaced only once.** Replacing it again returns 422:
  "This badge cannot be replaced because it has already been replaced." To
  change it again, replace the current version.
- **Notifications:** if `notification_message` is given, the earner is told
  about the replacement and the message is included in the email.
  `suppress_badge_notification_email: true` stops the replace notification,
  but, unlike on issue, **it does not stop later notifications** such as
  reminders for a pending badge.
- Afterwards the old badge is in state `replaced`, and the two are linked by
  `replacement_badge_id` and `replaces_badge_id`.
- **The replacement has a new id.** The data dictionary says "Any update to
  an issued badge results in a new badge ID."
- **It is not like updating a template.** `PUT /badge_templates/{id}`
  changes only the fields sent. A replace clears every field that isn't
  sent. Anyone who has used one will expect the other to behave the same
  way.
- Permissions: a token with read and write, or the `issued_badges` scope.

### Still to establish in the sandbox

Record the results in `CLAUDE.md` with the date, as syncjar does.

1. Does the badge URL change? The id does (see above), and `badge_url`
   looks like it is built from the id. If the URL changes, links the earner
   has already shared stop working, as they do with a reissue, and the
   command has to say so.
2. Does an accepted badge stay accepted, or does the replacement start as
   `pending` and need accepting again?
3. With neither `notification_message` nor suppression, is the earner told?
4. What happens to evidence, skills and group tags that weren't sent again?
   The reference suggests they are lost.
5. Does replacing an `expires_at` badge with `expires_at: false` really
   remove the expiry?

### Design

`npm run replace -- --badge <id> [--first-name …] [--last-name …] [--email …]
[--template …] [--issued-at …] [--expires-at …] [--message "…"]` and
`--in changes.csv`.

- **Read, merge, then send the whole badge.** Read the badge, apply only the
  fields the operator changed, and send the result. Because omitted fields
  become `null`, sending only the changes would silently wipe data. This is
  the most important rule in this plan. Put the merge in a pure module
  (`replace-plan.mjs`) and test that every field survives when unchanged.
- **Show a per-badge diff** of old and new values, like syncjar's push does.
  A field that goes from a value to empty is shown as a change, never hidden.
- **Refuse, in the preflight:** badges in `replaced` state (point at
  `replacement_badge_id` instead), email changes on non-pending badges, and
  badges in `revoked` or `rejected` state, unless replacing those turns out
  to be meaningful.
- The same `--dry-run`, typed confirmation, sequential writes and audit CSV
  as issue and revoke. The audit records old id, new id and every changed
  field's old value, so a replace can be undone by replacing again.
- **Verify by reading back.** After a replace, read the new badge and compare
  it with what was sent. A mismatch is a failure, not a warning. syncjar
  learned that a 200 does not always mean the write happened.
- Never retry the POST after a 5xx. The client already enforces this.

## Delete

### What it is for

Removing a badge that should never have existed. For example, a test issue
in production, or a badge issued to the wrong address and still pending.
Anything else is better handled by revoke, which keeps a record and tells
the earner why.

### What the reference says

- `DELETE /badges/{id}` returns 204. It needs a token with `read` and
  `delete` permission (`delete_enabled`). With OAuth it needs only
  `issued_badges`, the same scope that issuing uses.
- **Replaced badges cannot be deleted.** The API returns 422: "You can not
  delete replaced badges. Delete the current version instead."
- The reference says nothing else: nothing about which states can be deleted,
  whether the earner is told, or what the earner sees afterwards.
- A `badge.deleted` webhook event exists, so Credly does record the
  deletion somewhere.

### Still to establish in the sandbox

1. Which states can be deleted: pending, accepted, revoked, rejected?
2. Is the earner notified?
3. What does the earner's public badge URL show afterwards?
4. After a delete, does `GET /badges/{id}` return 404, and is the badge gone
   from `GET /badges`, or kept with some state?
5. Deleting the current version of a replaced chain: does the older,
   `replaced` badge come back, stay, or go too?
6. Is there any way to get a deleted badge back? Assume not until shown
   otherwise.
7. Does the `badge.deleted` event appear in `GET /events`, and does it hold
   the deleted badge's data? If so, it is a record of the deletion outside
   credjar's audit file.

### Design

`npm run delete -- --badge <id> --reason "…"`, **one badge per run by
default**. `--in` is allowed only with an explicit `--bulk`.

- Delete is the one command where a wrong run cannot be seen afterwards.
  Revoke leaves a record, but delete doesn't. So the audit CSV is the only
  record and must hold the **entire badge as it was read**, as JSON in one
  column, not just a few fields. The audit is written before the DELETE is
  sent, not after, so a crash in the middle still leaves the record.
- `--reason` is required even though the API does not take one. It goes in
  the audit file, because nothing else will record why.
- The confirmation asks the operator to type the recipient's email for a
  single badge, or the count for `--bulk`, instead of the environment name. That
  makes the operator look at who is affected.
- Default to allowing only `pending` badges. `--allow-accepted` covers the rest,
  and the help text points to `revoke` instead.
- **Use a separate token for deletes.** The token in `CREDLY_API_TOKEN`
  should be created without `delete_enabled`, so that no other credjar
  command, and no bug in one, can delete anything. `delete` reads its token
  from its own setting, `CREDLY_DELETE_TOKEN`, and refuses to run without
  it. It never falls back to the everyday token. Without a delete token, the
  first 403 ends the run, which `isRunFatal()` already does.
- **Don't check permissions by reading `GET /authorization_tokens`.** It
  returns every token's secret (see `CLAUDE.md`). The separate-token rule
  above makes the check unnecessary.
- Read back after the delete: a 404 confirms it, and anything else is a
  failure.
- Update `CLAUDE.md`, "Destructive operations", when this lands.

## Order

1. Sandbox experiments for both, with the results written into `CLAUDE.md`.
2. `replace`, because the need for it is more common and it is less
   destructive.
3. `delete`, if the experiments show it is needed and safe to do this way.

Each is its own PR to `dev`, with tests for the planning module before the
command itself.
