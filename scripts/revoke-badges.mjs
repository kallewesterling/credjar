/**
 * revoke-badges.mjs — `npm run revoke`: revoke issued badges by id.
 *
 * There is no un-revoke. Giving someone their badge back means issuing a new
 * one, which emails them again and gives the badge a new id and URL, so any
 * link they already shared stops working. So:
 *
 *   1. Read every badge first. Only badges someone currently holds (pending
 *      or accepted) are revoked; the rest are shown and skipped.
 *   2. Show the plan, including each earner. With --dry-run, stop here.
 *   3. Ask for the environment's name to be typed, unless --yes.
 *   4. PUT one at a time, and write an audit CSV recording each badge's
 *      state before the run, so a mistaken run can be put right precisely.
 *
 * `--reason` is required, and Credly shows it to the earner in the
 * revocation email unless --suppress-email is set.
 */
import chalk from 'chalk';
import { createCredlyClient, describeError } from './credly-client.mjs';
import { fetchOrganization, fetchIssuedBadge } from './credly-fetch.mjs';
import { mapWithConcurrency } from './concurrency.mjs';
import { parseCsv } from './csv.mjs';
import { planRevokes, badgeIdsFromRows } from './revoke-plan.mjs';
import {
  baseParser,
  confirmWrite,
  describeTarget,
  isMain,
  isRunFatal,
  readInput,
  writeDataCsv
} from './run.mjs';
import { ok, fail, skip, muted, heading } from './ui.mjs';

const READ_CONCURRENCY = 4;

const AUDIT_COLUMNS = [
  'badge_id',
  'recipient_email',
  'template_name',
  'prior_state',
  'result',
  'detail'
];

export function buildRevokeParser(args) {
  return baseParser(args)
    .usage(
      'npm run revoke -- --badge <id> --reason "…" [options]\n' +
        'npm run revoke -- --in badges.csv --reason "…" [options]\n\n' +
        'Revoke issued badges. The CSV needs a badge_id column; the CSV that\n' +
        '`npm run badges -- --csv` writes has one.'
    )
    .option('badge', { type: 'array', string: true, default: [], describe: 'Badge id to revoke (repeatable)' })
    .option('in', { type: 'string', describe: 'CSV with a badge_id column' })
    .option('reason', { type: 'string', describe: 'Why. Recorded on the badge and shown to the earner' })
    .option('suppress-email', {
      type: 'boolean',
      default: false,
      describe: 'Ask Credly not to email earners about the revocation'
    })
    .option('yes', { type: 'boolean', default: false, describe: 'Skip the typed confirmation' })
    .check((a) => {
      if (!a.in && !a.badge.length) throw new Error('Pass --badge <id> (repeatable) or --in <file.csv>.');
      if (!a.reason || !a.reason.trim()) throw new Error('--reason is required. Credly records it on the badge.');
      return true;
    });
}

export function parseRevokeArgs(args) {
  return buildRevokeParser(args).parseSync();
}

async function readBadgeIds(argv) {
  const ids = [...argv.badge];
  if (argv.in) {
    let rows;
    try {
      rows = parseCsv(await readInput(argv.in));
    } catch (err) {
      console.error(fail(`Could not read ${argv.in}: ${err.code ?? err.message}`));
      process.exit(1);
    }
    const { ids: fromFile, missing } = badgeIdsFromRows(rows);
    if (missing.length) {
      console.error(fail(`${argv.in}: no badge_id on line${missing.length === 1 ? '' : 's'} ${missing.join(', ')}. Nothing was revoked.`));
      process.exit(1);
    }
    ids.push(...fromFile);
  }
  return ids;
}

async function main() {
  const argv = parseRevokeArgs(process.argv.slice(2));
  const ids = await readBadgeIds(argv);

  let client;
  try {
    client = createCredlyClient();
  } catch (err) {
    console.error(fail(err.message));
    process.exit(1);
  }
  const org = await fetchOrganization(client);
  console.log(heading(`\nRevoke badges — ${describeTarget(org, client)}`));

  // 1. Read every badge.
  const badges = new Map();
  await mapWithConcurrency([...new Set(ids)], READ_CONCURRENCY, async (id) => {
    badges.set(id, await fetchIssuedBadge(client, id, { allowMissing: true }));
  });
  const { toRevoke, skipped } = planRevokes(ids, badges);

  // 2. The plan.
  if (skipped.length) {
    console.log(skip(`${skipped.length} will be skipped:`));
    for (const s of skipped) {
      console.log(muted(`    ${s.id}  ${s.badge?.recipient_email ?? ''}  ${s.reason}`));
    }
  }
  console.log(chalk.bold(`\n${toRevoke.length} badge${toRevoke.length === 1 ? '' : 's'} to revoke:`));
  for (const { id, badge } of toRevoke) {
    console.log(`    ${id}  ${badge.state.padEnd(8)}  ${badge.recipient_email}  ${muted(badge.badge_template?.name ?? '')}`);
  }
  console.log(muted(`\n  Reason: ${argv.reason}`));
  console.log(
    argv.suppressEmail
      ? muted('  Credly will be asked not to email earners.')
      : muted('  Each earner will get an email from Credly, including the reason.')
  );
  console.log(muted('  There is no un-revoke. Restoring a badge means issuing a new one.'));

  if (!toRevoke.length) {
    console.log();
    console.log(skip('Nothing to revoke.'));
    return;
  }
  if (argv.dryRun) {
    console.log();
    console.log(skip('Dry run: nothing was revoked.'));
    return;
  }

  // 3. Confirm.
  const confirmed = await confirmWrite(
    `About to revoke ${toRevoke.length} badge${toRevoke.length === 1 ? '' : 's'} in ${describeTarget(org, client)}.`,
    { environment: client.environment, yes: argv.yes }
  );
  if (!confirmed) {
    console.log(skip('Not confirmed. Nothing was revoked.'));
    process.exit(1);
  }

  // 4. Write, one at a time.
  const audit = skipped.map((s) => auditRow(s.id, s.badge, 'skipped', s.reason));
  let revoked = 0;
  let failed = 0;
  let stopped = false;

  for (const { id, badge } of toRevoke) {
    if (stopped) {
      audit.push(auditRow(id, badge, 'not attempted', 'run stopped after an earlier failure'));
      continue;
    }
    try {
      await client.put(`/badges/${id}/revoke`, {
        reason: argv.reason,
        suppress_revoke_notification_email: argv.suppressEmail
      });
      revoked += 1;
      audit.push(auditRow(id, badge, 'revoked', ''));
      console.log(ok(`${id} ${muted(badge.recipient_email)}`));
    } catch (err) {
      failed += 1;
      const detail = describeError(err);
      audit.push(auditRow(id, badge, 'failed', detail));
      console.log(fail(`${id} — ${detail}`));
      if (isRunFatal(err)) {
        console.log(fail('Stopping: this failure is not specific to one badge.'));
        stopped = true;
      }
    }
  }

  const file = await writeDataCsv('revoke', audit, AUDIT_COLUMNS);
  console.log(`\n${revoked} revoked, ${failed} failed, ${skipped.length} skipped.`);
  console.log(muted(`Audit: ${file}`));
  if (failed || stopped) process.exit(1);
}

function auditRow(id, badge, result, detail) {
  return {
    badge_id: id,
    recipient_email: badge?.recipient_email ?? '',
    template_name: badge?.badge_template?.name ?? '',
    prior_state: badge?.state ?? '',
    result,
    detail
  };
}

if (isMain(import.meta.url)) main();
