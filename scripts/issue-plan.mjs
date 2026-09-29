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
      const key = duplicateKey(payload.recipient_email, payload.badge_template_id);
      if (seen.has(key)) {
        reasons.push(`same person and badge as the row on line ${seen.get(key) ?? '?'}`);
      } else {
        seen.set(key, line);
      }
    }

    if (reasons.length) invalid.push({ line, email: payload.recipient_email ?? '', reasons });
    else planned.push({ line, payload });
  }

  return { planned, invalid };
}

/**
 * Splits planned issues into those to send and those that would duplicate a
 * badge the person already holds.
 *
 * `existing` maps duplicateKey() to the badges already issued for that
 * person and template, as returned by the API. A person holds the badge if
 * any of them is in a HOLDING_STATES state.
 */
export function splitDuplicates(planned, existing) {
  const toIssue = [];
  const duplicates = [];
  for (const entry of planned) {
    const key = duplicateKey(entry.payload.recipient_email, entry.payload.badge_template_id);
    const held = (existing.get(key) || []).find((b) => HOLDING_STATES.has(b.state));
    if (held) duplicates.push({ ...entry, existing: held });
    else toIssue.push(entry);
  }
  return { toIssue, duplicates };
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
