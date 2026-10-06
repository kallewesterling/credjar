/**
 * list-badges.mjs — `npm run badges`: list issued badges, optionally as CSV.
 *
 * The badge id in the first column is what `revoke` takes, and the CSV this
 * writes can be filtered in a spreadsheet and handed straight to
 * `npm run revoke -- --in`.
 *
 * Exports hold real names and email addresses. They go to public/data/,
 * which is gitignored; delete them when you are done.
 */
import chalk from 'chalk';
import { createCredlyClient } from './credly-client.mjs';
import { fetchOrganization, fetchIssuedBadges } from './credly-fetch.mjs';
import { baseParser, describeTarget, isMain, writeDataCsv } from './run.mjs';
import { ok, fail, skip, muted } from './ui.mjs';

export const BADGE_COLUMNS = [
  'badge_id',
  'state',
  'recipient_email',
  'first_name',
  'last_name',
  'template_id',
  'template_name',
  'issued_at',
  'expires_at',
  'state_updated_at',
  'issuer_earner_id',
  'revocation_reason',
  'badge_url'
];

/** One flat row per badge, for CSV and for the terminal. */
export function flattenBadge(b) {
  return {
    badge_id: b.id,
    state: b.state,
    recipient_email: b.recipient_email,
    first_name: b.issued_to_first_name,
    last_name: b.issued_to_last_name,
    template_id: b.badge_template?.id,
    template_name: b.badge_template?.name,
    issued_at: b.issued_at,
    expires_at: b.expires_at,
    state_updated_at: b.state_updated_at,
    issuer_earner_id: b.issuer_earner_id,
    revocation_reason: b.revocation_reason,
    badge_url: b.badge_url
  };
}

export function buildBadgeParser(args) {
  return baseParser(args)
    .usage('npm run badges -- [options]\n\nList issued badges.')
    .option('template', { type: 'string', describe: 'Only badges from this badge template id' })
    .option('email', { type: 'string', describe: 'Only badges issued to this email address' })
    .option('state', {
      type: 'string',
      describe: 'Only badges in this state: pending, accepted, rejected, revoked, replaced (comma-separated)'
    })
    .option('query', { type: 'string', describe: 'Partial match on earner name or email' })
    .option('since', { type: 'string', describe: 'Issued on or after this date (YYYY-MM-DD)' })
    .option('until', { type: 'string', describe: 'Issued on or before this date (YYYY-MM-DD)' })
    .option('limit', { type: 'number', describe: 'Stop after this many badges' })
    .option('json', { type: 'boolean', default: false, describe: 'Print the full records as JSON' })
    .option('csv', { type: 'boolean', default: false, describe: 'Also write a CSV to public/data/' });
}

export function parseBadgeArgs(args) {
  return buildBadgeParser(args).parseSync();
}

async function main() {
  const argv = parseBadgeArgs(process.argv.slice(2));

  let client;
  try {
    client = createCredlyClient({ sandbox: argv.sandbox });
  } catch (err) {
    console.error(fail(err.message));
    process.exit(1);
  }

  const badges = await fetchIssuedBadges(client, {
    filter: {
      badge_template_id: argv.template,
      recipient_email: argv.email,
      state: argv.state,
      query: argv.query,
      issued_at_date_min: argv.since,
      issued_at_date_max: argv.until
    },
    sort: '-issued_at',
    limit: argv.limit
  });
  const rows = badges.map(flattenBadge);

  if (argv.json) {
    console.log(JSON.stringify(badges, null, 2));
  } else {
    const org = await fetchOrganization(client);
    console.error(muted(describeTarget(org, client)));
    console.log(chalk.bold(`\n${rows.length} issued badge${rows.length === 1 ? '' : 's'}\n`));
    for (const r of rows) {
      const date = (r.issued_at ?? '').slice(0, 10);
      console.log(`  ${r.badge_id}  ${String(r.state).padEnd(9)} ${date}  ${r.recipient_email}  ${muted(r.template_name ?? '')}`);
    }
  }

  if (argv.csv) {
    if (argv.dryRun) {
      console.error(skip(`Dry run: would write ${rows.length} badges to public/data/`));
    } else {
      const file = await writeDataCsv('badges', rows, BADGE_COLUMNS);
      console.error(ok(`Wrote ${file}`));
      console.error(muted('  It contains names and email addresses. Delete it when you are done.'));
    }
  }
}

if (isMain(import.meta.url)) main();
