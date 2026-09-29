/**
 * list-templates.mjs — `npm run templates`: list the organization's badge
 * templates, with the ids `issue` needs.
 */
import chalk from 'chalk';
import { createCredlyClient } from './credly-client.mjs';
import { fetchOrganization, fetchBadgeTemplates } from './credly-fetch.mjs';
import { baseParser, describeTarget, isMain, writeDataCsv } from './run.mjs';
import { ok, fail, skip, muted } from './ui.mjs';

export const TEMPLATE_COLUMNS = ['id', 'name', 'state', 'public', 'level', 'time_to_earn', 'url', 'created_at', 'updated_at'];

export function buildTemplateParser(args) {
  return baseParser(args)
    .usage('npm run templates -- [options]\n\nList badge templates.')
    .option('state', {
      type: 'string',
      describe: 'Only templates in this state, e.g. active, draft, archived (comma-separated)'
    })
    .option('name', { type: 'string', describe: 'Partial match on template name' })
    .option('json', { type: 'boolean', default: false, describe: 'Print the full records as JSON' })
    .option('csv', { type: 'boolean', default: false, describe: 'Also write a CSV to public/data/' });
}

export function parseTemplateArgs(args) {
  return buildTemplateParser(args).parseSync();
}

async function main() {
  const argv = parseTemplateArgs(process.argv.slice(2));

  let client;
  try {
    client = createCredlyClient();
  } catch (err) {
    console.error(fail(err.message));
    process.exit(1);
  }

  const templates = await fetchBadgeTemplates(client, {
    filter: { state: argv.state, name: argv.name },
    sort: 'name'
  });

  if (argv.json) {
    console.log(JSON.stringify(templates, null, 2));
  } else {
    const org = await fetchOrganization(client);
    console.error(muted(describeTarget(org, client)));
    console.log(chalk.bold(`\n${templates.length} badge template${templates.length === 1 ? '' : 's'}\n`));
    for (const t of templates) {
      const state = t.state === 'active' ? chalk.green(t.state) : chalk.yellow(t.state);
      console.log(`  ${t.id}  ${state.padEnd(18)} ${t.name}`);
    }
  }

  if (argv.csv) {
    if (argv.dryRun) {
      console.error(skip(`Dry run: would write ${templates.length} templates to public/data/`));
    } else {
      const file = await writeDataCsv('templates', templates, TEMPLATE_COLUMNS);
      console.error(ok(`Wrote ${file}`));
    }
  }
}

if (isMain(import.meta.url)) main();
