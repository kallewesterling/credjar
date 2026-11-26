#!/usr/bin/env node
/**
 * credjar — the global command.
 *
 *   credjar <command> [options]   run an npm script, e.g. `credjar issue --dry-run`
 *   credjar update [--ref <ref>] [--force]
 *                                 install from GitHub (default ref: main), unless
 *                                 that commit is the one installed
 *   credjar help                  list commands
 *
 * Each command runs as its own process, from the current directory, exactly
 * as `npm run <command> -- [options]` would from a clone.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { REPO_ROOT, IS_CHECKOUT } from '../scripts/run.mjs';
import {
  COMMIT_ACCEPT,
  INSTALL_RECORD,
  commandTable,
  commitUrl,
  configDir,
  envFiles,
  githubRepo,
  installSpec,
  layeredEnv,
  parseCommit,
  providesCommand,
  rawPackageUrl,
  readInstallRecord,
  updateDecision
} from '../scripts/cli.mjs';
import { fail, heading, muted, ok } from '../scripts/ui.mjs';

const DEFAULT_REF = 'main';

const readPackage = () => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const pkg = readPackage();
const commands = commandTable(pkg.scripts);

function installedFrom() {
  const record = readInstallRecord(REPO_ROOT);
  return record ? `(${record.ref} @ ${record.commit.slice(0, 7)})` : '';
}

function usage() {
  const userEnv = path.join(configDir(), '.env');
  console.log(`${heading('credjar')} ${pkg.version} ${muted(IS_CHECKOUT ? `(clone at ${REPO_ROOT})` : installedFrom())}

${heading('Usage')}
  credjar <command> [options]
  credjar update [--ref <branch|tag|commit>]   install from GitHub (default: ${DEFAULT_REF}),
                 [--force]                    unless that commit is already installed
  credjar <command> --help                     options for one command

${heading('Commands')}`);
  for (const name of commands.keys()) console.log(`  ${name}`);
  console.log(`
${heading('Credentials')}
  Read from .env in the current directory, then ${IS_CHECKOUT ? 'the clone\'s .env, then ' : ''}${userEnv}.
  A variable already set in the shell wins over all of them.
  Exports and audit files go to public/data/ under ${IS_CHECKOUT ? 'the clone' : 'the current directory'}.`);
}

/**
 * Runs `cmd` with inherited stdio and resolves with its exit code. Ctrl+C
 * reaches the child directly (same process group), so the CLI ignores it
 * and lets the child exit on its own; a write run stopped that way still
 * gets to answer for the rows it has done.
 */
function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const ignore = () => {};
    process.on('SIGINT', ignore);
    const child = spawn(cmd, args, { stdio: 'inherit', ...options });
    child.on('error', (err) => {
      console.error(fail(`Could not start ${cmd}: ${err.message}`));
      resolve(1);
    });
    child.on('exit', (code, signal) => {
      process.off('SIGINT', ignore);
      resolve(code ?? 128 + (os.constants.signals[signal] ?? 0));
    });
  });
}

async function update(args) {
  if (IS_CHECKOUT) {
    console.error(fail(`This credjar runs from a git clone at ${REPO_ROOT}.`));
    console.error(muted('  Update it there with git pull; `credjar update` is for installs made with npm install -g.'));
    return 1;
  }

  const refAt = args.findIndex((a) => a === '--ref' || a.startsWith('--ref='));
  const ref = refAt === -1 ? DEFAULT_REF : (args[refAt].split('=')[1] ?? args[refAt + 1]);
  const repo = githubRepo(pkg.repository);
  if (!repo) {
    console.error(fail('package.json has no GitHub repository to update from.'));
    return 1;
  }

  try {
    installSpec(repo, ref ?? '');
  } catch (err) {
    console.error(fail(err.message));
    return 1;
  }

  let commit;
  try {
    const res = await fetch(commitUrl(repo, ref), { headers: { Accept: COMMIT_ACCEPT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    commit = parseCommit(await res.text());
    if (!commit) throw new Error('no commit in the response');
  } catch (err) {
    console.error(fail(`Could not resolve ${repo}#${ref} to a commit (${err.message}).`));
    console.error(muted('  Check the ref exists on GitHub. Nothing was changed.'));
    return 1;
  }
  const short = commit.slice(0, 7);

  const record = readInstallRecord(REPO_ROOT);
  const decision = updateDecision({ record, commit, force: args.includes('--force') });
  if (!decision.install) {
    console.log(ok(`credjar ${pkg.version} from ${ref} (${short}) is already installed.`));
    console.log(muted('  Nothing to do. Run with --force to reinstall it anyway.'));
    return 0;
  }

  const spec = installSpec(repo, commit);
  let target;
  try {
    const res = await fetch(rawPackageUrl(repo, commit));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    target = await res.json();
  } catch (err) {
    console.error(fail(`Could not read package.json at ${repo}#${ref} (${err.message}).`));
    console.error(muted('  Check the ref exists on GitHub. Nothing was changed.'));
    return 1;
  }
  if (!providesCommand(target)) {
    console.error(fail(`${repo}#${ref} does not provide the credjar command yet.`));
    console.error(muted('  Installing it would remove credjar from your machine. Nothing was changed.'));
    return 1;
  }

  console.log(`Installing ${repo}#${ref} (${short}) ${muted(`(currently ${pkg.version}, ${decision.reason})`)}\n`);
  const code = await run('npm', ['install', '--global', spec], { shell: process.platform === 'win32' });
  if (code !== 0) {
    console.error(fail(`npm install exited with ${code}. The previous install is unchanged.`));
    return code;
  }
  const version = readPackage().version;
  try {
    fs.writeFileSync(
      path.join(REPO_ROOT, INSTALL_RECORD),
      `${JSON.stringify({ repo, ref, commit, version, installedAt: new Date().toISOString() }, null, 2)}\n`
    );
  } catch (err) {
    console.error(muted(`  Could not record the installed commit (${err.message}); the next update will reinstall.`));
  }
  console.log(`\n${ok(`credjar ${version} installed from ${ref} (${short})`)}`);
  console.log(muted('  package.json records the last release, so a branch install can show the same version.'));
  return 0;
}

async function main(argv) {
  const [name, ...args] = argv;

  if (!name || name === 'help' || name === '--help' || name === '-h') {
    usage();
    return 0;
  }
  if (name === '--version' || name === '-v') {
    console.log(pkg.version);
    return 0;
  }
  if (name === 'update') return update(args);

  const file = commands.get(name);
  if (!file) {
    console.error(fail(`Unknown command: ${name}`));
    console.error(muted('  Run `credjar help` for the list.'));
    return 1;
  }

  const env = layeredEnv(envFiles({ checkoutRoot: IS_CHECKOUT ? REPO_ROOT : null }));
  // inputPath() prefers INIT_CWD, which an enclosing `npm run` may have left
  // pointing somewhere other than where credjar was run.
  delete env.INIT_CWD;
  return run(process.execPath, [path.join(REPO_ROOT, file), ...args], { env });
}

process.exitCode = await main(process.argv.slice(2));
