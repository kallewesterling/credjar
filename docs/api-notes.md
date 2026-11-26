---
title: Credly API notes
nav_order: 9
---

# Credly API notes
{: .no_toc }

A map of the Credly API as its reference documents it, what Credjar uses,
and what the reference says that the endpoint names alone don't. They're
useful if you write your own tooling against it. Compiled on 2026-09-30
from every page of <https://docs.credly.com/browse/reference> (45
endpoints) and the guide pages. Where this disagrees with what the live API
does, the live API wins. Credly may change any of it.

1. TOC
{:toc}

---

## Reading the reference

The site is rendered with JavaScript, but every page has a `.md` version
with its OpenAPI fragment embedded:

```bash
# every endpoint slug
curl -s https://docs.credly.com/browse/reference \
  | grep -oE '/browse/reference/[a-z0-9_-]+' | sort -u

# one endpoint, with its spec
curl -s https://docs.credly.com/browse/reference/post_v1-organizations-organization-id-badges.md
```

Guides are at `/browse/docs/<slug>.md`: `api-fundamentals`,
`authentication-methods`, `data-dictionary` (the state enums and what each
means) and others.

Credly also runs an MCP server for its docs and API at
`https://docs.credly.com/mcp`. It is useful when researching, but credjar
does not depend on it.

## Environments and authentication

| | Production | Sandbox |
|---|---|---|
| API | `https://api.credly.com/v1` | `https://sandbox-api.credly.com/v1` |
| OAuth token | `https://api.credly.com/oauth/token` | not documented; presumably the sandbox host |

Tokens only work in the environment they were created in.

**Authorization tokens** are what credjar uses. HTTP Basic, with the token
as the username and a blank password. They last 180 days. Each has three
separate flags, `read_enabled`, `write_enabled` and `delete_enabled`, and
each endpoint needs particular ones (see the table below). A token can
create new tokens with the same permissions or fewer, never more.

**OAuth 2.0** (`client_credentials`) gives 2-hour bearer tokens with scopes:
`authorization_tokens`, `badge_templates`, `events`, `invitations`,
`issued_badges`, `memberships`, `oauth_applications`, `organizations`,
`pathways`, `recommendations` and `workforce`. The scopes are per resource,
not per action: **`issued_badges` covers read, issue, replace, revoke and
delete together**. For keeping delete out of reach, an authorization token
without `delete_enabled` is finer-grained than any OAuth scope. Some
endpoints (organizations, authorization tokens, issuers) have no OAuth scope
and need an authorization token.

### Hazard: `GET /authorization_tokens` returns secrets

The response includes a `token` field holding **the secret of every listed
token**, and a token with delete permission sees all of them. A command that
printed this response, or wrote it to a file, would leak every credential
the organization has. Credjar never calls it.

## Conventions

- Responses are wrapped as `{ data, metadata }`.
- Lists page with `page` and `per`. `metadata` has `current_page`,
  `total_pages`, `total_count`, `per` and `next_page_url`. The default `per`
  is 50, and no maximum is documented.
- Filters are `filter[key]=value`. The `key::value|key::value` form is
  deprecated.
- Sort is `sort=key1|-key2`, and each list documents its own sortable keys.
- Errors: 400 for a missing parameter, 404 `{ message }`, 422
  `{ data: { message, errors: [{ attribute, messages }] } }`.
- Rate limits: not documented. The client backs off on 429 and honours
  `Retry-After`.

## States

From the data dictionary.

| Badge state | Meaning |
|---|---|
| `pending` | Issued, not yet accepted. Has a claim URL, unique to the earner. |
| `accepted` | Accepted by the earner. |
| `rejected` | Rejected by the earner, "most likely due to an errored account merge". |
| `revoked` | Revoked by the organization. The earner no longer sees it in their wallet or on their profile. |
| `replaced` | Superseded. "Any update to an issued badge results in a new badge ID." |

| Template state | Meaning |
|---|---|
| `active` | Shown as "Published" in the UI. Can be issued from. |
| `draft` | Cannot be issued from. Not searchable or listable. |
| `archived` | No longer issued from, but still referenced by its badges. |

## Duplicates

When issuing, a badge counts as a duplicate of an existing badge from the
same template if **any** of these is true:

- it has the same `recipient_email`;
- it has the same `issuer_earner_id`;
- it goes to the same Credly user under another email. For example, the
  earner has both `john.doe@` and `jdoe@` on their profile.

Duplicates are refused by default, unless the template's
`allow_duplicate_badges` is on. `duplicate_behavior` (`deny`, `allow` or
`replace`) overrides this, but only on templates that refuse duplicates. A
refused duplicate is a 422: "Recipient Email associated with this user
already has this badge issued to another email address".

The `recipient_email_all` filter on `GET /badges` matches on a user's
primary and secondary emails, which is how a preflight can find the third
kind of duplicate.

## Endpoints

Paths are relative to `/v1/organizations/{organization_id}` unless they
start with `/v1`. "Token" is the authorization-token permission the
reference lists; "Scope" is the OAuth scope.

### Issued badges

| Method and path | Token | Scope | credjar |
|---|---|---|---|
| `GET /badges` | read | issued_badges | `badges`, and `issue`'s duplicate check |
| `GET /badges/{id}` | read | issued_badges | `revoke` preflight |
| `POST /badges` | read, write | issued_badges | `issue` |
| `PUT /badges/{id}/revoke` | read, write | issued_badges | `revoke` |
| `POST /badges/{id}/replace` | read, write | issued_badges | not yet; see the [plan](https://github.com/kallewesterling/credjar/blob/dev/docs/plans/replace-and-delete.md) |
| `DELETE /badges/{id}` | read, delete | issued_badges | not yet; see the [plan](https://github.com/kallewesterling/credjar/blob/dev/docs/plans/replace-and-delete.md) |
| `GET /high_volume_issued_badge_search` | read | issued_badges | not used; see the [roadmap](https://github.com/kallewesterling/credjar/blob/dev/docs/plans/roadmap.md) |

- **Filters** on `GET /badges`: `badge_template_id`, `recipient_email`,
  `recipient_email_all`, `issuer_earner_id`, `user_id`, `issuer_id`,
  `state`, `public`, `query` (name or partial email), and `_min`/`_max`
  pairs for `created_at`, `updated_at`, `issued_at`, `issued_at_date`,
  `expires_at`, `expires_at_date` and `state_updated_at`.
- **Sort keys:** `created_at`, `issued_at`, `sortable_user`, `state`,
  `state_updated_at` and `badge_templates[name]`.
- **The bulk search** takes the same filters with no sort. It is ordered by
  `created_at`, then `id`. `badge_format` is `default`, `minimal`,
  `default_with_skills` or `minimal_with_evidence`.
- **Issue body.** Required: `badge_template_id`, `issued_at`,
  `issued_to_first_name`, `issued_to_last_name` and `recipient_email`.
  Optional: `issued_to_middle_name`, `expires_at` (`false` means no expiry),
  `issuer_earner_id`, `issuer_earner_group(s)` (group tags,
  `{ external_id | name }`), `country_name`, `state_or_province`, `locale`,
  `evidence`, `duplicate_behavior` and `suppress_badge_notification_email`.
- **Evidence** is an array of typed items: `PlainTextEvidence`,
  `UrlEvidence`, `IdEvidence` and `KeyValueGroupEvidence`.
- **Revoke** takes `reason` (required) and
  `suppress_revoke_notification_email`.
- **Replace** takes the issue fields except that `recipient_email` is
  optional, plus `notification_message`. See the
  [plan](https://github.com/kallewesterling/credjar/blob/dev/docs/plans/replace-and-delete.md)
  for its traps.
- **Delete:** replaced badges can't be deleted (422).

### Badge templates

| Method and path | Token | Scope | credjar |
|---|---|---|---|
| `GET /badge_templates` | read | badge_templates | `templates` |
| `GET /badge_templates/{id}` | read | badge_templates | `issue` preflight |
| `POST /badge_templates` | write | badge_templates | `templates:create` |
| `PUT /badge_templates/{id}` | write | badge_templates | no |
| `DELETE /badge_templates/{id}` | delete | badge_templates | no |
| `GET/POST /badge_templates/{id}/endorsements`, `GET/PUT/DELETE …/{id}` | read, write, delete | badge_templates | no |

- **Filters:** `state`, `name` (partial, or exact in double quotes),
  `query`, `public`, `skills`, `reporting_tags`, `collection_id`,
  `owner_id`, `recommendation_ids`, `endorsement`, and `created_at` and
  `updated_at` ranges.
- **Sort keys:** `name`, `created_at`, `updated_at`, `state`, `public` and
  `badges_count`.
- **Creating a template** requires `name`, `description`, `image` (a URL or
  base64), at least three `skills` and at least one
  `badge_template_activities` entry. A criteria URL
  (`global_activity_url`) is also said to be required.
- **Updating a template** changes only the fields sent. This is the
  opposite of replacing a badge, which nulls any field not sent.
- **Endorsements:** at most one per organization per template. Each needs a
  `description` or at least one `credits` entry.

### Organization, tokens, issuers

| Method and path | Token | Scope | credjar |
|---|---|---|---|
| `GET /v1/organizations` | read | none | no. It could find `CREDLY_ORG_ID` for a new user. |
| `GET /` (the organization) | read | none | `check`, and every command's header |
| `PUT /` | write | none | no. This is the public profile, and `webhook_url` is set here. |
| `GET /authorization_tokens` | read | none | no. **Returns secrets**, see above. |
| `POST /authorization_tokens` | write | none | no |
| `POST /authorization_tokens/rotate` | write | none | never. It invalidates the calling token immediately. |
| `GET /issuers`, `DELETE /issuers/{id}` | read, delete | none | no. Organizations authorized to issue on this one's behalf. |
| `GET /grantors` | read | none | no. Organizations that have authorized this one. |

OAuth applications are managed at `/oauth_applications`, which has full CRUD.
The client secret is shown only once, on create.

### Events and webhooks

| Method and path | Token | Scope | credjar |
|---|---|---|---|
| `GET /events` | read (not listed) | events | no; see the [roadmap](https://github.com/kallewesterling/credjar/blob/dev/docs/plans/roadmap.md) |
| `GET /events/{id}` | read (not listed) | events | no |

Event types: `badge.created`, `badge.deleted`, `badge.state.changed`,
`badge.privacy.changed`, `badge_template.created`, `badge_template.changed`
and `badge_template.deleted`, plus 21 `employment.*` and `user.*` types for
Workforce.

Webhooks are configured in the UI, under Developers → Webhooks, with the
delivery URL, event types and custom headers. Credly POSTs a summary
(`id`, `event_type`, `occurred_at`) and expects a 2xx response. Failed
deliveries are retried for up to 25 days. The full event is then read from
`GET /events/{id}`.

### Workforce, recommendations

Out of scope for credjar unless the organization uses these products.

- **Workforce:** `/employees` (full CRUD), `/employees/{id}/data`,
  `/employees/send_invitations`, `/employee_skills` and
  `/employee_external_badges`. Scope `workforce`.
- **Recommendations:** `/recommendations` (CRUD, `PATCH` to update) and
  `/recommendations/{id}/badge_templates`. Scope `recommendations`.

OAuth also lists `pathways`, `memberships` and `invitations` scopes. The
reference documents no endpoints for them.
