/**
 * create-template.mjs — `npm run templates:create`: create a badge template
 * from a JSON file and a PNG.
 *
 *   1. Validate the file and the image locally (template-plan.mjs). Any
 *      problem stops the run before a request is made.
 *   2. Read the organization's templates, and refuse if one already has
 *      this name. Two templates with one name is a mess to untangle, and
 *      a rerun after an unclear failure is the usual way to get one.
 *   3. Show what will be created. With --dry-run, stop here.
 *   4. Ask for the environment's name to be typed, unless --yes.
 *   5. POST, then read the template back and compare it with what was sent.
 *   6. Write an audit CSV.
 *
 * A template is not sent to anyone, so this is less dangerous than issuing.
 * But one created as `active` can be issued from at once, and the API can't
 * cleanly undo a create: DELETE /badge_templates/{id} exists, but credjar
 * doesn't call it (see docs/plans/roadmap.md). So the same care applies.
 *
 * Never retried after a 5xx; the client enforces that for every POST. If one
 * happens, the template may exist anyway: run `npm run templates` before
 * trying again, and step 2 will stop a duplicate.
 */
import chalk from 'chalk';
import { createCredlyClient, describeError } from './credly-client.mjs';
import { fetchOrganization, fetchBadgeTemplates, fetchBadgeTemplate } from './credly-fetch.mjs';
import { planTemplate, verifyTemplate, pngSize } from './template-plan.mjs';
import {
  baseParser,
  confirmWrite,
  describeTarget,
  inputPath,
  isMain,
  readInput,
  writeDataCsv
} from './run.mjs';
import { ok, fail, skip, muted, heading } from './ui.mjs';

const AUDIT_COLUMNS = ['name', 'state', 'result', 'template_id', 'detail', 'file'];

export function buildCreateTemplateParser(args) {
  return baseParser(args)
    .usage(
      'npm run templates:create -- --file template.json --image badge.png [options]\n\n' +
        'Create a badge template. See examples/badge-template.json for the file format.'
    )
    .option('file', { type: 'string', demandOption: true, describe: 'JSON file describing the template' })
    .option('image', { type: 'string', describe: 'PNG for the badge, at least 600×600. Or set image_url in the file' })
    .option('yes', { type: 'boolean', default: false, describe: 'Skip the typed confirmation' });
}

export function parseCreateTemplateArgs(args) {
  return buildCreateTemplateParser(args).parseSync();
}

async function readFiles(argv) {
  let file;
  try {
    file = JSON.parse(await readInput(argv.file));
  } catch (err) {
    console.error(fail(`Could not read ${argv.file}: ${err.code ?? err.message}`));
    process.exit(1);
  }
  let image;
  if (argv.image) {
    try {
      image = await readInput(argv.image, null);
    } catch (err) {
      console.error(fail(`Could not read ${argv.image}: ${err.code ?? err.message}`));
      process.exit(1);
    }
  }
  return { file, image };
}

async function main() {
  const argv = parseCreateTemplateArgs(process.argv.slice(2));

  // 1. Validate locally, before any request.
  const { file, image } = await readFiles(argv);
  const { payload, problems } = planTemplate(file, { image });
  if (problems.length) {
    console.error(fail(`${argv.file} can't be created as it is. Nothing was sent.\n`));
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  let client;
  try {
    client = createCredlyClient({ sandbox: argv.sandbox });
  } catch (err) {
    console.error(fail(err.message));
    process.exit(1);
  }
  const org = await fetchOrganization(client);
  console.log(heading(`\nCreate badge template — ${describeTarget(org, client)}`));

  // 2. No second template with the same name. The quotes ask Credly for an
  // exact match; the comparison below makes sure of it.
  const sameName = (await fetchBadgeTemplates(client, { filter: { name: `"${payload.name}"` } }))
    .filter((t) => t.name.trim().toLowerCase() === payload.name.toLowerCase());
  if (sameName.length) {
    console.error(fail(`A template named "${payload.name}" already exists. Nothing was sent.`));
    for (const t of sameName) console.error(muted(`    ${t.id}  ${t.state}`));
    process.exit(1);
  }

  // 3. The plan.
  const size = image ? pngSize(image) : null;
  console.log(chalk.bold(`\n  ${payload.name}`));
  console.log(`  ${payload.description}`);
  console.log(muted(`\n  ${'state'.padEnd(23)} ${payload.state ?? '(Credly default)'}`));
  console.log(muted(`  ${'skills'.padEnd(23)} ${payload.skills.join(', ')}`));
  for (const a of payload.badge_template_activities) {
    console.log(muted(`  ${'criterion'.padEnd(23)} ${a.activity_type}: ${a.title}`));
  }
  console.log(muted(`  ${'image'.padEnd(23)} ${image ? `${argv.image} (${size.width}×${size.height})` : file.image_url}`));
  for (const key of ['level', 'type_category', 'time_to_earn', 'cost', 'public', 'allow_duplicate_badges', 'global_activity_url']) {
    if (payload[key] !== undefined) console.log(muted(`  ${key.padEnd(23)} ${payload[key]}`));
  }
  if (payload.state === 'active') {
    console.log(muted('\n  Active: badges can be issued from it as soon as it exists.'));
  }

  if (argv.dryRun) {
    console.log();
    console.log(skip('Dry run: nothing was sent.'));
    return;
  }

  // 4. Confirm.
  const confirmed = await confirmWrite(
    `About to create "${payload.name}" in ${describeTarget(org, client)}.`,
    { environment: client.environment, yes: argv.yes }
  );
  if (!confirmed) {
    console.log(skip('Not confirmed. Nothing was sent.'));
    process.exit(1);
  }

  // 5. Create, then read back.
  const auditRow = { name: payload.name, state: payload.state ?? '', file: inputPath(argv.file) };
  let created;
  try {
    ({ data: { data: created } } = await client.post('/badge_templates', payload));
  } catch (err) {
    const detail = describeError(err);
    console.log(fail(`Not created — ${detail}`));
    if (!err?.response || err.response.status >= 500) {
      console.log(fail('The template may exist anyway. Check with `npm run templates` before retrying.'));
    }
    const auditFile = await writeDataCsv('create-template', [{ ...auditRow, result: 'failed', detail }], AUDIT_COLUMNS);
    console.log(muted(`Audit: ${auditFile}`));
    process.exit(1);
  }

  const readBack = await fetchBadgeTemplate(client, created.id, { allowMissing: true });
  const mismatches = verifyTemplate(payload, readBack);
  const result = mismatches.length ? 'created, but differs' : 'created';
  const auditFile = await writeDataCsv(
    'create-template',
    [{ ...auditRow, state: readBack?.state ?? '', result, template_id: created.id, detail: mismatches.join('; ') }],
    AUDIT_COLUMNS
  );

  if (mismatches.length) {
    console.log(fail(`Created ${created.id}, but it doesn't match what was sent:`));
    for (const m of mismatches) console.log(`  - ${m}`);
    console.log(muted(`Audit: ${auditFile}`));
    process.exit(1);
  }
  console.log(ok(`Created ${chalk.bold(readBack.name)} ${muted(`${created.id}, ${readBack.state}`)}`));
  if (readBack.url) console.log(muted(`  ${readBack.url}`));
  console.log(muted(`Audit: ${auditFile}`));
}

if (isMain(import.meta.url)) main();
