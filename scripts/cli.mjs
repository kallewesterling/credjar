/**
 * cli.mjs — what the global `credjar` command needs to know, kept apart from
 * `bin/credjar.mjs` so it can be tested without spawning anything. The same
 * design as syncjar's.
 *
 * The npm scripts in package.json stay the single list of commands: `credjar
 * issue` runs exactly what `npm run issue` runs, so a new script is a new
 * subcommand the day it is added.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';

const NODE_SCRIPT = /^node\s+(scripts\/\S+\.mjs)$/;

/**
 * Maps each npm script of the form `node scripts/….mjs` to that file.
 * Scripts in any other form (`test`) are not subcommands.
 *
 * @returns {Map<string, string>} script name → command file, relative to the package root
 */
export function commandTable(scripts) {
  const table = new Map();
  for (const [name, body] of Object.entries(scripts ?? {})) {
    const match = body?.trim().match(NODE_SCRIPT);
    if (match) table.set(name, match[1]);
  }
  return table;
}

/**
 * The directory holding a user-level `.env`, for running credjar from
 * anywhere: `$XDG_CONFIG_HOME/credjar`, else `~/.config/credjar`, or
 * `%APPDATA%\credjar` on Windows.
 */
export function configDir({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (platform === 'win32' && env.APPDATA) return path.join(env.APPDATA, 'credjar');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'credjar');
}

/**
 * The `.env` files a command can draw on, lowest precedence first. The
 * client calls `dotenv.config()`, which reads only `<cwd>/.env` and never
 * overrides a variable already set, so the CLI layers the rest underneath
 * before spawning the command.
 */
export function envFiles({ cwd = process.cwd(), checkoutRoot = null, userConfigDir = configDir() } = {}) {
  const files = [path.join(userConfigDir, '.env')];
  if (checkoutRoot) files.push(path.join(checkoutRoot, '.env'));
  files.push(path.join(cwd, '.env'));
  return [...new Set(files)];
}

/**
 * Merges `files` (lowest precedence first) under `baseEnv`, so a variable set
 * in the shell always wins. Missing files are skipped.
 */
export function layeredEnv(files, baseEnv = process.env, readFile = fs.readFileSync) {
  const merged = {};
  for (const file of files) {
    let text;
    try {
      text = readFile(file, 'utf8');
    } catch {
      continue;
    }
    Object.assign(merged, dotenv.parse(text));
  }
  return { ...merged, ...baseEnv };
}

/**
 * `owner/name` from package.json's `repository`, which npm accepts as a
 * string or as `{ url }`. Null if it does not name a GitHub repository.
 */
export function githubRepo(repository) {
  const url = typeof repository === 'string' ? repository : repository?.url;
  const match = url?.match(/^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/)
    || url?.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * Whether a package.json, read from the ref about to be installed, still
 * provides the `credjar` command. Installing one that doesn't removes the
 * command along with the old install, leaving nothing to run
 * `credjar update` from to get back. Every ref from before the CLI existed
 * is one of those.
 */
export function providesCommand(packageJson) {
  return typeof packageJson?.bin?.credjar === 'string';
}

/** The URL of package.json at `ref` of a public GitHub repository. */
export function rawPackageUrl(repo, ref) {
  return `https://raw.githubusercontent.com/${repo}/${encodeURI(ref)}/package.json`;
}

/**
 * The GitHub API URL that resolves `ref` of a public repository to the commit
 * it points at, answered as the bare SHA when asked with `COMMIT_ACCEPT`.
 */
export function commitUrl(repo, ref) {
  return `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`;
}

export const COMMIT_ACCEPT = 'application/vnd.github.sha';

/** The full commit SHA in a `commitUrl` response body, or null if the body is anything else. */
export function parseCommit(body) {
  const sha = String(body ?? '').trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/**
 * The file `credjar update` writes into the install it just made, naming the
 * commit installed. npm keeps no record of it, and the version cannot stand
 * in: package.json records the last release, so every commit on a branch
 * carries the same one. The install directory is replaced on each update,
 * which removes the old record with the old code.
 */
export const INSTALL_RECORD = '.credjar-install.json';

/**
 * The install record under `root`, or null when there is none or it is not
 * readable as one. An install made with `npm install -g` directly has none.
 */
export function readInstallRecord(root, readFile = fs.readFileSync) {
  try {
    const record = JSON.parse(readFile(path.join(root, INSTALL_RECORD), 'utf8'));
    return parseCommit(record?.commit) ? record : null;
  } catch {
    return null;
  }
}

/**
 * Whether `credjar update` should install `commit`. Only a recorded commit
 * equal to it skips; without a record there is no telling what is
 * installed, so it installs.
 *
 * @returns {{ install: boolean, reason: string }}
 */
export function updateDecision({ record, commit, force = false }) {
  if (force) return { install: true, reason: 'forced' };
  if (!record) return { install: true, reason: 'no record of the installed commit' };
  if (record.commit === commit) return { install: false, reason: 'already installed' };
  return { install: true, reason: `installed commit is ${record.commit.slice(0, 7)}` };
}

/**
 * The spec `npm install --global` takes to install `ref` of `repo` straight
 * from GitHub. `ref` is a branch, tag or commit.
 */
export function installSpec(repo, ref) {
  if (!/^[\w./-]+$/.test(ref) || ref.startsWith('-')) {
    throw new Error(`Not a usable git ref: ${JSON.stringify(ref)}`);
  }
  return `github:${repo}#${ref}`;
}
