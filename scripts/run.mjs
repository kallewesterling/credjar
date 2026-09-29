/**
 * run.mjs — what every command shares: the common flags, the entry-point
 * guard, the confirmation before a write, and the audit file after one.
 *
 * `--dry-run` means the same thing on every command: reads happen, writes do
 * not — neither to Credly nor to disk. On `issue` and `revoke` that makes a
 * dry run a real preflight, because the reads it makes are the ones the live
 * run acts on: the template checks, the duplicate check, each badge's state.
 * A dry run that only printed the input back would prove nothing about
 * whether the live run would work.
 */
import path from 'path';
import fs from 'fs/promises';
import readline from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import { toCsv } from './csv.mjs';

export const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(REPO_ROOT, 'public', 'data');

/**
 * True when `metaUrl` is the script node was asked to run, rather than one
 * being imported. Every entry point checks this, so importing a command —
 * from a test, or a `node -e` one-liner — never runs it.
 */
export function isMain(metaUrl) {
  return Boolean(process.argv[1]) && metaUrl === pathToFileURL(path.resolve(process.argv[1])).href;
}

/** A yargs parser with the options every command takes. */
export function baseParser(args = hideBin(process.argv)) {
  return yargs(args)
    .option('dry-run', {
      type: 'boolean',
      default: false,
      describe: 'Make the reads, show what would happen, and write nothing to Credly or to disk'
    })
    .strictOptions()
    .wrap(Math.min(110, process.stdout.columns || 110))
    .help();
}

/** A short timestamp for file names: 2026-09-30T14-05-09Z. */
export function fileStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

/** The header line every command prints first, so the target is never a guess. */
export function describeTarget(org, client) {
  const env = client.environment === 'production'
    ? chalk.red.bold('PRODUCTION')
    : chalk.cyan.bold('sandbox');
  return `${chalk.bold(org?.name ?? client.orgId)} ${chalk.gray(`(${client.orgId})`)} on ${env}`;
}

/**
 * Asks the operator to confirm a write by typing the environment's name.
 *
 * Typing `production` rather than `y` is the point: it cannot be done on
 * autopilot, and it forces a look at which environment is about to change.
 * `--yes` skips the prompt for scripted use. Without a terminal and without
 * `--yes`, this refuses rather than hanging or assuming.
 *
 * Returns true to go ahead.
 */
export async function confirmWrite(summary, { environment, yes = false }) {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.error(chalk.red('\n✗ Not running in a terminal, so there is no one to confirm this.'));
    console.error(chalk.red('   Pass --yes to go ahead without a prompt, or --dry-run to preview.'));
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\n${summary}\nType ${chalk.bold(environment)} to continue: `);
    return answer.trim() === environment;
  } finally {
    rl.close();
  }
}

/**
 * Writes rows to `public/data/credjar-<action>-<stamp>.csv` and returns the
 * path. Used for the audit record of every write run: what was attempted,
 * what the state was before, and what came back, so a mistaken run can be
 * examined and undone row by row rather than guessed at.
 */
export async function writeDataCsv(action, rows, columns, { dir = DATA_DIR, stamp = fileStamp() } = {}) {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `credjar-${action}-${stamp}.csv`);
  await fs.writeFile(file, toCsv(rows, columns));
  return file;
}

/**
 * Whether a failed write says something about the whole run, rather than
 * about the one row. A 422 for a bad email is that row's problem and the
 * run can go on; a 401 means every following request will fail the same
 * way, and a 5xx or a network error means the service is not in a state to
 * keep writing to.
 */
export function isRunFatal(err) {
  const status = err?.response?.status;
  if (!status) return true;
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

/**
 * Reads a file relative to where the operator ran the command. `npm run`
 * moves the working directory to the package root, and records the original
 * one in INIT_CWD, so `npm run issue -- --in ../people.csv` means what it
 * looks like it means.
 */
export function readInput(file) {
  return fs.readFile(path.resolve(process.env.INIT_CWD ?? process.cwd(), file), 'utf8');
}
