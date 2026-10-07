/**
 * issue-plan.mjs — decides what `npm run issue` will do, without doing it.
 *
 * Issuing a badge emails a real person, and there is no way to unsend that.
 * So everything that can be decided before the first write is decided here,
 * from the input and from reads, and shown in full before anything is sent:
 * which rows are invalid, which people already hold the badge, and exactly
 * what payload each remaining row will POST.
 *
 * Nothing in this module makes a request.
 */

// A badge in one of these states means the person already holds it, so
// issuing again would be a duplicate. Revoked, rejected and replaced badges
// do not count: the person does not currently hold them.
export const HOLDING_STATES = new Set(['pending', 'accepted']);

// Loose on purpose: Credly does the real validation and answers with a 422.
// This only catches the obviously wrong, like a name in the email column.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Column names accepted in an input CSV, and the payload field each fills.
 * The left-hand names are what a spreadsheet is likely to use; the right
 * are Credly's.
 */
export const INPUT_COLUMNS = {
  email: 'recipient_email',
  recipient_email: 'recipient_email',
  first_name: 'issued_to_first_name',
  last_name: 'issued_to_last_name',
  middle_name: 'issued_to_middle_name',
  template_id: 'badge_template_id',
  badge_template_id: 'badge_template_id',
  issued_at: 'issued_at',
  expires_at: 'expires_at',
  issuer_earner_id: 'issuer_earner_id'
};

const REQUIRED_FIELDS = [
  ['recipient_email', 'email'],
  ['issued_to_first_name', 'first_name'],
  ['issued_to_last_name', 'last_name'],
  ['badge_template_id', 'template_id (or --template)']
];

/** A key that identifies "this person, this badge". Emails compare case-insensitively. */
export function duplicateKey(email, templateId) {
  return `${String(email).trim().toLowerCase()}\u0000${templateId}`;
}

/**
 * Turns input rows into badge payloads, and reports every row that cannot be
 * one. Never throws on bad input: the caller shows every problem at once
 * rather than the first.
 *
 * `defaults` fills gaps: `templateId` for rows with no template column, and
 * `issuedAt` (an ISO string) for rows with no date. Per-row values win.
 *
 * Returns `{ planned, invalid }`. Each planned entry is
 * `{ line, payload }`; each invalid entry is `{ line, email, reasons }`.
 */
export function planIssues(rows, { templateId, issuedAt, suppressEmail = false } = {}) {
  const planned = [];
  const invalid = [];
  const seen = new Map();

  for (const row of rows) {
    const line = row._line ?? null;
    const payload = {};
    for (const [column, value] of Object.entries(row)) {
      const field = INPUT_COLUMNS[column];
      if (field && value !== undefined && value !== '') payload[field] = String(value).trim();
    }
    if (!payload.badge_template_id && templateId) payload.badge_template_id = templateId;
    if (!payload.issued_at && issuedAt) payload.issued_at = issuedAt;
    if (suppressEmail) payload.suppress_badge_notification_email = true;

    const reasons = [];
    for (const [field, label] of REQUIRED_FIELDS) {
      if (!payload[field]) reasons.push(`missing ${label}`);
    }
    if (payload.recipient_email && !EMAIL_SHAPE.test(payload.recipient_email)) {
      reasons.push(`"${payload.recipient_email}" does not look like an email address`);
    }
    for (const field of ['issued_at', 'expires_at']) {
      if (payload[field] && Number.isNaN(Date.parse(payload[field]))) {
        reasons.push(`${field} "${payload[field]}" is not a date`);
      }
    }
    if (!payload.issued_at) reasons.push('missing issued_at');

    if (!reasons.length) {
      // Credly counts the same issuer_earner_id as the same person, so the
      // file is held to that too.
      const keys = [duplicateKey(payload.recipient_email, payload.badge_template_id)];
      if (payload.issuer_earner_id) {
        keys.push(`earner\u0000${payload.issuer_earner_id}\u0000${payload.badge_template_id}`);
      }
      const earlier = keys.find((k) => seen.has(k));
      if (earlier) {
        reasons.push(`same person and badge as the row on line ${seen.get(earlier) ?? '?'}`);
      } else {
        for (const k of keys) seen.set(k, line);
      }
    }

    if (reasons.length) invalid.push({ line, email: payload.recipient_email ?? '', reasons });
    else planned.push({ line, payload });
  }

  return { planned, invalid };
}

/**
 * The badge searches that, between them, find every badge Credly would call
 * a duplicate of this one.
 *
 * Credly counts a badge as a duplicate of an existing one from the same
 * template if it has the same `recipient_email`, or the same
 * `issuer_earner_id`, or goes to the same Credly user under another of their
 * email addresses. Each of those needs its own search:
 *
 *   email             `recipient_email` — exact address, including pending
 *                     badges to people with no Credly account yet
 *   same_user         `recipient_email_all` — every address on the user's
 *                     profile, primary and secondary
 *   issuer_earner_id  only when the row has one
 *
 * `email` and `same_user` overlap, and both are made anyway. The reference
 * does not say whether `recipient_email_all` finds a pending badge whose
 * recipient has no account, and asking twice costs one request per row.
 */
export function duplicateSearches(payload) {
  const template = payload.badge_template_id;
  const searches = [
    { kind: 'email', filter: { badge_template_id: template, recipient_email: payload.recipient_email } },
    { kind: 'same_user', filter: { badge_template_id: template, recipient_email_all: payload.recipient_email } }
  ];
  if (payload.issuer_earner_id) {
    searches.push({
      kind: 'issuer_earner_id',
      filter: { badge_template_id: template, issuer_earner_id: payload.issuer_earner_id }
    });
  }
  return searches;
}

// Most specific first, so a badge found by more than one search is reported
// the way the operator will most easily recognise it.
const MATCH_ORDER = ['email', 'issuer_earner_id', 'same_user'];

/**
 * Decides, from the results of duplicateSearches(), whether this person
 * already holds this badge.
 *
 * `results` is `[{ kind, badges }]`. Returns `{ held, problem }`: `held` is
 * `{ badge, match }` or null, and `problem` is a string when the results
 * cannot be trusted, in which case the run must stop rather than guess.
 *
 * Server-side filters are not taken on faith. A result from the wrong
 * template, or an `email` or `issuer_earner_id` result that does not match,
 * is dropped. `same_user` cannot be checked the same way, since a user's
 * other addresses are not visible to us, so it gets a different check: one
 * address belongs to at most one user. Results spanning several users mean
 * the filter did not do what it is documented to do.
 */
export function findHeld(payload, results) {
  const template = payload.badge_template_id;
  const email = String(payload.recipient_email).trim().toLowerCase();
  const matches = [];

  for (const { kind, badges } of results) {
    const relevant = badges.filter((b) => b.badge_template?.id === template);

    if (kind === 'same_user') {
      const users = new Set(relevant.map((b) => b.user?.id).filter(Boolean));
      if (users.size > 1) {
        return {
          held: null,
          problem:
            `searching Credly for other badges held by ${payload.recipient_email} returned ` +
            `badges for ${users.size} different users, so the duplicate check cannot be trusted`
        };
      }
    }

    for (const badge of relevant) {
      if (!HOLDING_STATES.has(badge.state)) continue;
      const sameEmail = String(badge.recipient_email ?? '').trim().toLowerCase() === email;
      if (kind === 'email' && !sameEmail) continue;
      if (kind === 'issuer_earner_id' && badge.issuer_earner_id !== payload.issuer_earner_id) continue;
      matches.push({ badge, match: sameEmail ? 'email' : kind });
    }
  }

  matches.sort((a, b) => MATCH_ORDER.indexOf(a.match) - MATCH_ORDER.indexOf(b.match));
  return { held: matches[0] ?? null, problem: null };
}

/**
 * Splits planned issues into those to send and those that would duplicate a
 * badge the person already holds.
 *
 * `held` maps duplicateKey() to findHeld()'s `held` for that row.
 */
export function splitDuplicates(planned, held) {
  const toIssue = [];
  const duplicates = [];
  for (const entry of planned) {
    const h = held.get(duplicateKey(entry.payload.recipient_email, entry.payload.badge_template_id));
    if (h) duplicates.push({ ...entry, existing: h.badge, match: h.match });
    else toIssue.push(entry);
  }
  return { toIssue, duplicates };
}

/** Why a duplicate counts as one, in words, for the plan and the audit file. */
export function describeDuplicate({ existing, match }) {
  const held = `${existing.state}, ${existing.id}`;
  if (match === 'issuer_earner_id') {
    return `same issuer_earner_id as the badge issued to ${existing.recipient_email} (${held})`;
  }
  if (match === 'same_user') {
    return `same Credly user as the badge issued to ${existing.recipient_email} (${held})`;
  }
  return `already holds it (${held})`;
}

/**
 * Checks each template the plan uses. A template has to exist and be
 * `active` before badges can be issued from it; a draft or archived one is
 * a mistake worth stopping for, not a per-row failure.
 *
 * `templates` maps template id to the template record, or to null if the
 * read came back 404. Returns a list of problems; empty means all is well.
 */
export function checkTemplates(templateIds, templates) {
  const problems = [];
  for (const id of templateIds) {
    const t = templates.get(id);
    if (!t) problems.push(`badge template ${id} does not exist in this organization`);
    else if (t.state !== 'active') problems.push(`badge template "${t.name}" (${id}) is ${t.state}, not active`);
  }
  return problems;
}
