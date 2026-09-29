/**
 * issue-badges.mjs — `npm run issue`: issue badges to one person or to a
 * CSV of people.
 *
 * Issuing sends each recipient an email from Credly, and that cannot be
 * unsent. So the run is built to do all of its deciding before the first
 * write, and to show that decision in full:
 *
 *   1. Validate every input row. Any invalid row stops the run, so a file is
 *      fixed and rerun whole rather than half-issued.
 *   2. Read each template the rows use. It must exist and be active.
 *   3. Look for existing badges from that template by the person's email,
 *      by any other email on their Credly profile, and by issuer_earner_id,
 *      and set aside anyone who already holds it (pending or accepted).
 *   4. Show the plan. With --dry-run, stop here.
 *   5. Ask for the environment's name to be typed, unless --yes.
 *   6. POST one at a time, and write an audit CSV of every row's outcome.
 *
 * Writes are sequential on purpose. Throughput does not matter at the size
 * of a class list, and one at a time means that a failure which ends the run
 * (an expired token, an outage) leaves a clean line between what was issued
 * and what was not, which the audit file records.
 */
import chalk from 'chalk';
import { createCredlyClient, describeError } from './credly-client.mjs';
import { fetchOrganization, fetchBadgeTemplate, fetchIssuedBadges } from './credly-fetch.mjs';
import { mapWithConcurrency } from './concurrency.mjs';
import { parseCsv } from './csv.mjs';
import {
  planIssues,
  splitDuplicates,
  checkTemplates,
  duplicateKey,
  duplicateSearches,
  findHeld,
  describeDuplicate
} from './issue-plan.mjs';
import {
  baseParser,
  confirmWrite,
  describeTarget,
  isMain,
  isRunFatal,
  readInput,
  writeDataCsv
} from './run.mjs';
import { ok, warn, fail, skip, muted, heading } from './ui.mjs';

// Reads in flight during the duplicate check. Reads only; writes are serial.
const READ_CONCURRENCY = 4;

const AUDIT_COLUMNS = [
  'line',
  'recipient_email',
  'first_name',
  'last_name',
  'template_id',
  'result',
  'badge_id',
  'detail'
];

export function buildIssueParser(args) {
  return baseParser(args)
    .usage(
      'npm run issue -- --template <id> --in people.csv [options]\n' +
        'npm run issue -- --template <id> --email a@b.c --first-name A --last-name B\n\n' +
        'Issue badges. The CSV needs email, first_name and last_name columns, and\n' +
        'may add template_id, issued_at, expires_at, middle_name, issuer_earner_id.'
    )
    .option('template', { type: 'string', describe: 'Badge template id, for rows that do not name one' })
    .option('in', { type: 'string', describe: 'CSV of recipients' })
    .option('email', { type: 'string', describe: 'Recipient email, to issue a single badge' })
    .option('first-name', { type: 'string', describe: 'Recipient first name, with --email' })
    .option('last-name', { type: 'string', describe: 'Recipient last name, with --email' })
    .option('issued-at', {
      type: 'string',
      describe: 'Date the badge was earned, for rows that do not give one. Default: now'
    })
    .option('suppress-email', {
      type: 'boolean',
      default: false,
      describe: 'Ask Credly not to email recipients about their badge'
    })
    .option('allow-duplicate', {
      type: 'boolean',
      default: false,
      describe: 'Issue even to people who already hold this badge'
    })
    .option('yes', { type: 'boolean', default: false, describe: 'Skip the typed confirmation' })
    .check((a) => {
      if (!a.in && !a.email) throw new Error('Pass --in <file.csv>, or --email with --first-name and --last-name.');
      if (a.in && a.email) throw new Error('Pass --in or --email, not both.');
      if (a.email && (!a.firstName || !a.lastName)) throw new Error('--email needs --first-name and --last-name.');
      if (a.issuedAt && Number.isNaN(Date.parse(a.issuedAt))) throw new Error(`--issued-at "${a.issuedAt}" is not a date.`);
      return true;
    });
}

export function parseIssueArgs(args) {
  return buildIssueParser(args).parseSync();
}

async function readRows(argv) {
  if (argv.email) {
    return [{ email: argv.email, first_name: argv.firstName, last_name: argv.lastName }];
  }
  let text;
  try {
    text = await readInput(argv.in);
  } catch (err) {
    console.error(fail(`Could not read ${argv.in}: ${err.code ?? err.message}`));
    process.exit(1);
  }
  try {
    return parseCsv(text);
  } catch (err) {
    console.error(fail(`${argv.in}: ${err.message}`));
    process.exit(1);
  }
}

async function main() {
  const argv = parseIssueArgs(process.argv.slice(2));

  // 1. Validate the input, before any request.
  const rows = await readRows(argv);
  const issuedAt = argv.issuedAt ? new Date(argv.issuedAt).toISOString() : new Date().toISOString();
  const { planned, invalid } = planIssues(rows, {
    templateId: argv.template,
    issuedAt,
    suppressEmail: argv.suppressEmail
  });

  if (invalid.length) {
    console.error(fail(`${invalid.length} of ${rows.length} rows cannot be issued. Nothing was sent.\n`));
    for (const r of invalid) {
      console.error(`  ${r.line ? `line ${r.line}` : 'input'}: ${r.email || '(no email)'} — ${r.reasons.join('; ')}`);
    }
    process.exit(1);
  }
  if (!planned.length) {
    console.log(skip('No rows to issue.'));
    return;
  }

  let client;
  try {
    client = createCredlyClient();
  } catch (err) {
    console.error(fail(err.message));
    process.exit(1);
  }
  const org = await fetchOrganization(client);
  console.log(heading(`\nIssue badges — ${describeTarget(org, client)}`));

  // 2. Every template must exist and be active.
  const templateIds = [...new Set(planned.map((p) => p.payload.badge_template_id))];
  const templates = new Map();
  for (const id of templateIds) templates.set(id, await fetchBadgeTemplate(client, id, { allowMissing: true }));
  const templateProblems = checkTemplates(templateIds, templates);
  if (templateProblems.length) {
    for (const p of templateProblems) console.error(fail(p));
    console.error(fail('Nothing was sent.'));
    process.exit(1);
  }

  // 3. Who already holds the badge, by any of the rules Credly uses.
  const held = new Map();
  const problems = [];
  await mapWithConcurrency(planned, READ_CONCURRENCY, async ({ payload }) => {
    const results = [];
    for (const { kind, filter } of duplicateSearches(payload)) {
      results.push({ kind, badges: await fetchIssuedBadges(client, { filter }) });
    }
    const { held: h, problem } = findHeld(payload, results);
    if (problem) problems.push(problem);
    held.set(duplicateKey(payload.recipient_email, payload.badge_template_id), h);
  });
  if (problems.length) {
    for (const p of problems) console.error(fail(p));
    console.error(fail('Nothing was sent.'));
    process.exit(1);
  }
  const { toIssue: fresh, duplicates } = splitDuplicates(planned, held);
  const toIssue = argv.allowDuplicate ? planned : fresh;
  const skipped = argv.allowDuplicate ? [] : duplicates;

  // 4. The plan.
  const name = (id) => templates.get(id)?.name ?? id;
  if (duplicates.length) {
    console.log(
      argv.allowDuplicate
        ? warn(`${duplicates.length} already hold this badge, and --allow-duplicate is set, so they get another:`)
        : skip(`${duplicates.length} already hold this badge and will be skipped:`)
    );
    for (const d of duplicates) {
      console.log(muted(`    ${d.payload.recipient_email}  ${name(d.payload.badge_template_id)}  ${describeDuplicate(d)}`));
    }
  }
  console.log(chalk.bold(`\n${toIssue.length} badge${toIssue.length === 1 ? '' : 's'} to issue:`));
  for (const { payload: p } of toIssue) {
    console.log(`    ${p.recipient_email}  ${p.issued_to_first_name} ${p.issued_to_last_name}  ${muted(name(p.badge_template_id))}`);
  }
  console.log(
    argv.suppressEmail
      ? muted('\n  Credly will be asked not to email recipients.')
      : muted('\n  Each recipient will get an email from Credly. That cannot be unsent.')
  );

  if (!toIssue.length) {
    console.log();
    console.log(skip('Nothing to issue.'));
    return;
  }
  if (argv.dryRun) {
    console.log();
    console.log(skip('Dry run: nothing was sent.'));
    return;
  }

  // 5. Confirm.
  const confirmed = await confirmWrite(
    `About to issue ${toIssue.length} badge${toIssue.length === 1 ? '' : 's'} in ${describeTarget(org, client)}.`,
    { environment: client.environment, yes: argv.yes }
  );
  if (!confirmed) {
    console.log(skip('Not confirmed. Nothing was sent.'));
    process.exit(1);
  }

  // 6. Write, one at a time.
  const audit = skipped.map((d) => auditRow(d, 'skipped', d.existing.id, describeDuplicate(d)));
  let issued = 0;
  let failed = 0;
  let stopped = false;

  for (const entry of toIssue) {
    if (stopped) {
      audit.push(auditRow(entry, 'not attempted', '', 'run stopped after an earlier failure'));
      continue;
    }
    const body = {
      ...entry.payload,
      duplicate_behavior: argv.allowDuplicate ? 'allow' : 'deny'
    };
    try {
      const { data } = await client.post('/badges', body);
      issued += 1;
      audit.push(auditRow(entry, 'issued', data.data?.id ?? '', data.data?.state ?? ''));
      console.log(ok(`${entry.payload.recipient_email} ${muted(data.data?.id ?? '')}`));
    } catch (err) {
      failed += 1;
      const detail = describeError(err);
      audit.push(auditRow(entry, 'failed', '', detail));
      console.log(fail(`${entry.payload.recipient_email} — ${detail}`));
      if (isRunFatal(err)) {
        console.log(fail('Stopping: this failure is not specific to one row.'));
        stopped = true;
      }
    }
  }

  audit.sort((a, b) => (a.line || 0) - (b.line || 0));
  const file = await writeDataCsv('issue', audit, AUDIT_COLUMNS);
  console.log(`\n${issued} issued, ${failed} failed, ${skipped.length} skipped.`);
  console.log(muted(`Audit: ${file}`));
  if (failed || stopped) process.exit(1);
}

function auditRow(entry, result, badgeId, detail) {
  const p = entry.payload;
  return {
    line: entry.line ?? '',
    recipient_email: p.recipient_email,
    first_name: p.issued_to_first_name,
    last_name: p.issued_to_last_name,
    template_id: p.badge_template_id,
    result,
    badge_id: badgeId,
    detail
  };
}

if (isMain(import.meta.url)) main();
