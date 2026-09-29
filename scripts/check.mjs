/**
 * check.mjs — `npm run check`: confirm the credentials work and say where
 * they point.
 *
 * Run it first on a new .env. It reads the organization and one page of
 * badge templates, and writes nothing, so `--dry-run` changes nothing here;
 * it is accepted so every command takes the same flags.
 */
import chalk from 'chalk';
import { createCredlyClient } from './credly-client.mjs';
import { fetchOrganization, fetchAllPages } from './credly-fetch.mjs';
import { baseParser, describeTarget, isMain } from './run.mjs';
import { ok, fail, muted } from './ui.mjs';

async function main() {
  baseParser().usage('npm run check\n\nConfirm the Credly credentials in .env work.').parseSync();

  let client;
  try {
    client = createCredlyClient();
  } catch (err) {
    console.error(fail(err.message));
    process.exit(1);
  }

  const org = await fetchOrganization(client);
  console.log(ok(`Connected to ${describeTarget(org, client)}`));
  if (org.vanity_url) console.log(muted(`  ${org.vanity_url}`));

  const templates = await fetchAllPages(client, '/badge_templates', {
    limit: 1,
    describe: 'Connected, but could not list badge templates'
  });
  console.log(ok(`Can read badge templates ${muted(templates.length ? '' : '(none yet)')}`));

  console.log(chalk.gray('\nThis only checks read access. A token without write permission'));
  console.log(chalk.gray('will pass here and fail on issue or revoke with HTTP 403.'));
}

if (isMain(import.meta.url)) main();
