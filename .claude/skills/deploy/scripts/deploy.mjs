#!/usr/bin/env node
// Deploys a branch to the live site on this machine, for the deploy skill. It builds the branch's committed
// files in a temp folder, then copies the build into the live folder and update.php into the update folder,
// in the order docs/deployment.md gives. It finds both folders the way the health-server survey does, and
// never touches this checkout, its dist/, or the data the server owns.
//
//   node .claude/skills/deploy/scripts/deploy.mjs [--branch <name>] [--dry-run] [--update <dir>] [--lib <path>]
//
// main is deployed unless --branch names another branch. Whatever is checked out, and any uncommitted
// change, stays out of it. The repo is public, so nothing here names a host or a path on the server.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { locate } from '../../health-server/scripts/folders.mjs';

// The server owns these: cron writes the data and players folders, the History action builds the archive, and
// the credentials file is rewritten in place. The build holds stale copies of them when it's made in a checkout
const NEVER_COPY = ['data', 'history', 'players', 'auth.json'];
// Copied back to back, the library first, then update.php into the update folder: a new update.php that calls
// something the old library lacks dies on every cron run until the library catches up
const PHP_FIRST = ['fetch_lib.php', 'sportsbooks.json'];
// Cron calls update.php at the top of each minute, and the run loads its PHP straight away. The PHP step waits
// for this stretch of the minute, so no run can load the library and update.php from two different releases
const QUIET_FROM = 5;
const QUIET_UNTIL = 50;
// A fixed build folder: the bundler names a script after the folder it was built in as well as its contents,
// so a fixed folder keeps the same commit's file names the same from one deploy to the next
const BUILD_DIR = join(tmpdir(), 'timspicks-deploy');

class Stop extends Error {}
const stop = (text) => { throw new Stop(text); };
const say = (text = '') => console.log(text);

// --- Options ------------------------------------------------------------------------------------

const USAGE = 'Usage: deploy.mjs [--branch <name>] [--dry-run] [--update <dir>] [--lib <path>]';
const options = { branch: 'main', dryRun: false, update: null, lib: null };
const parseArgs = () => {
	const args = process.argv.slice(2).flatMap((arg) => (/^--\w+=/.test(arg) ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg]));
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const value = () => {
			const next = args[++index];
			if (!next || next.startsWith('-')) stop(`${arg} needs a value. ${USAGE}`);
			return next;
		};
		if (arg === '--branch') options.branch = value();
		else if (arg === '--dry-run') options.dryRun = true;
		else if (arg === '--update') options.update = value();
		else if (arg === '--lib') options.lib = value();
		else if (arg === '--help' || arg === '-h') { say(USAGE); process.exit(0); }
		else stop(`Unknown argument ${arg}. ${USAGE}`);
	}
};

// --- Helpers ------------------------------------------------------------------------------------

const run = (command, commandArgs, extra = {}) => execFileSync(command, commandArgs, {
	encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...extra,
});
const tryRun = (command, commandArgs) => { try { return run(command, commandArgs).replace(/\n$/, ''); } catch { return null; } };
const git = (...gitArgs) => tryRun('git', gitArgs);
const statOf = (path) => { try { return statSync(path); } catch { return null; } };
const isFile = (path) => !!path && !!statOf(path)?.isFile();
const isDir = (path) => !!path && !!statOf(path)?.isDirectory();
const listDir = (path) => { try { return readdirSync(path); } catch { return []; } };
const readText = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
const sameBytes = (a, b) => { try { return readFileSync(a).equals(readFileSync(b)); } catch { return false; } };
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const sleep = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// Every file under a folder, as paths relative to it, skipping Finder's .DS_Store
const walk = (root) => {
	const files = [];
	const visit = (dir, prefix) => {
		for (const name of listDir(dir)) {
			if (name === '.DS_Store') continue;
			const path = join(dir, name);
			const relativePath = prefix ? `${prefix}/${name}` : name;
			const info = statOf(path);
			if (info?.isDirectory()) visit(path, relativePath);
			else if (info?.isFile()) files.push(relativePath);
		}
	};
	visit(root, '');
	return files.sort();
};

// The local files an index.html loads, and the version the info popup shows, compiled in next to "Version"
const referencedBy = (index) => [...(index ?? '').matchAll(/\s(?:src|href)="(?:\.\/)?([^"#?]+)"/g)].map((match) => match[1])
	.filter((path) => !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path));
const versionOf = (dir) => {
	for (const path of referencedBy(readText(join(dir, 'index.html'))).filter((name) => name.endsWith('.js'))) {
		const version = /Version ?[`'"]\s*,\s*[`'"](\d+\.\d+\.\d+)[`'"]/.exec(readText(join(dir, path)) ?? '')?.[1];
		if (version) return version;
	}
	return null;
};

// Writes beside the target, then renames over it, so nothing ever loads a half-written file
const copied = [];
const place = (from, to) => {
	mkdirSync(dirname(to), { recursive: true });
	const temp = join(dirname(to), `.${basename(to)}.deploy-${process.pid}`);
	try {
		copyFileSync(from, temp);
		renameSync(temp, to);
		copied.push(to);
	} catch (error) {
		try { unlinkSync(temp); } catch { /* never written */ }
		throw error;
	}
};

// Runs a build step, and on failure stops with the end of its output
const step = (label, command, commandArgs, cwd) => {
	const begin = Date.now();
	try {
		run(command, commandArgs, { cwd, timeout: 10 * 60 * 1000 });
	} catch (error) {
		const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim().split('\n').slice(-25).join('\n');
		stop(`${label} failed, so nothing was copied:\n${output || error.message}`);
	}
	return (Date.now() - begin) / 1000;
};

// --- Deploy -------------------------------------------------------------------------------------

const deploy = () => {
	parseArgs();
	const repoRoot = git('rev-parse', '--show-toplevel') ?? stop('This has to run inside the checkout');
	process.chdir(repoRoot);

	// The branch: its committed files, whatever is checked out
	const { branch } = options;
	const sha = git('rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`) ?? stop(`There is no local branch ${branch}`);
	const version = JSON.parse(git('show', `${sha}:package.json`) ?? '{}').version ?? 'unknown';
	say(`${options.dryRun ? 'Dry run of deploying' : 'Deploying'} ${branch} at ${sha.slice(0, 7)} "${git('log', '-1', '--format=%s', sha)}", version ${version}`);
	if (git('rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`)) {
		const [ahead, behind] = (git('rev-list', '--left-right', '--count', `${sha}...origin/${branch}`) ?? '0 0').split(/\s+/).map(Number);
		if (ahead) say(`Note: ${branch} has ${plural(ahead, 'commit')} not pushed to origin/${branch}`);
		if (behind) say(`Note: ${branch} is ${plural(behind, 'commit')} behind origin/${branch}, as of the last fetch`);
	}
	if (branch === 'main' && git('rev-parse', '--verify', '-q', 'refs/heads/development')) {
		const waiting = Number(git('rev-list', '--count', `${sha}..development`) ?? 0);
		if (waiting) say(`Note: development has ${plural(waiting, 'commit')} main doesn't; they aren't part of this deploy until they're merged`);
	}
	if (branch !== 'main') {
		if (git('rev-parse', '--verify', '-q', 'refs/heads/main^{commit}') === sha) say(`Note: ${branch} is at the same commit as main`);
		else say(`Note: this deploys ${branch}, not main. /health-server reports the live folder as different from main until main is deployed again`);
	}
	if (git('symbolic-ref', '--short', '-q', 'HEAD') === branch && git('status', '--porcelain', '--untracked-files=no')) {
		say(`Note: the working tree has uncommitted changes; only what's committed on ${branch} is deployed`);
	}

	// The folders, from the cron line and the web server config
	const found = locate({ repoRoot, update: options.update, lib: options.lib });
	const { updateDir, liveDir } = found;
	if (!updateDir) stop('The update folder wasn\'t found from the cron line or the web server config; pass --update <dir>');
	if (!liveDir) stop('The live folder wasn\'t found, since no cron line gives its lib; pass --lib <path>');
	for (const dir of [updateDir, liveDir]) if (found.insideRepo(dir)) stop(`${dir} is inside this checkout, not a deployed folder`);
	if (!isFile(join(updateDir, 'update.php'))) stop(`${updateDir} has no update.php, so it isn't the update folder`);
	if (!isFile(join(liveDir, 'index.html')) || !isFile(join(liveDir, 'fetch_lib.php'))) stop(`${liveDir} has no index.html or fetch_lib.php, so it isn't the live folder`);
	say(`Live folder: ${liveDir}`);
	say(`Update folder: ${updateDir}`);

	// The build, from a clean archive of the commit: only tracked files, so none of the server's data
	const lock = join(BUILD_DIR, 'pid');
	if (isDir(BUILD_DIR)) {
		const pid = Number(readText(lock));
		if (pid && pid !== process.pid && alive(pid)) stop(`Another deploy is running (process ${pid})`);
		rmSync(BUILD_DIR, { recursive: true, force: true });
	}
	mkdirSync(join(BUILD_DIR, 'src'), { recursive: true });
	writeFileSync(lock, String(process.pid));
	const src = join(BUILD_DIR, 'src');
	run('git', ['archive', '--format=tar', `--output=${join(BUILD_DIR, 'ref.tar')}`, sha]);
	run('tar', ['-xf', join(BUILD_DIR, 'ref.tar'), '-C', src]);
	const installTime = step('npm ci', 'npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], src);
	const buildTime = step('npm run build', 'npm', ['run', 'build'], src);
	const out = join(src, 'dist');
	if (!isFile(join(out, 'index.html'))) stop('The build wrote no index.html, so nothing was copied');
	say(`Build: npm ci in ${installTime.toFixed(1)} s, npm run build in ${buildTime.toFixed(1)} s`);

	const built = walk(out);
	const held = built.filter((path) => NEVER_COPY.includes(path.split('/')[0]));
	if (held.length) say(`Note: the build holds ${[...new Set(held.map((path) => path.split('/')[0]))].join(', ')}, which a deploy never copies`);
	const files = built.filter((path) => !held.includes(path));
	const assets = files.filter((path) => path.startsWith('assets/'));

	// The front end is already live when every asset has a byte-identical live copy, under whatever name, and
	// index.html matches the live one with those names swapped in
	const liveAssets = walk(join(liveDir, 'assets')).map((path) => `assets/${path}`);
	const liveByDigest = new Map(liveAssets.map((path) => [digest(join(liveDir, path)), path]));
	const twins = new Map(assets.map((path) => [path, liveByDigest.get(digest(join(out, path)))]).filter(([, twin]) => twin));
	let frontEndLive = false;
	if (twins.size === assets.length) {
		let index = readText(join(out, 'index.html')) ?? '';
		for (const [path, twin] of twins) index = index.replaceAll(path, twin);
		frontEndLive = index === readText(join(liveDir, 'index.html'));
	}
	const liveVersion = versionOf(liveDir);

	// What to copy, in deploy order, leaving out files whose bytes already match
	const plan = [];
	let unchanged = 0;
	const add = (group, path, from, toDir) => {
		const to = join(toDir, path);
		if (sameBytes(from, to)) unchanged += 1;
		else plan.push({ group, path, from, to, where: toDir === updateDir ? 'update folder' : 'live folder' });
	};
	if (frontEndLive) unchanged += assets.length + 1;
	else {
		for (const path of assets) add('front', path, join(out, path), liveDir);
		add('front', 'index.html', join(out, 'index.html'), liveDir);
	}
	for (const path of PHP_FIRST.filter((name) => files.includes(name))) add('php', path, join(out, path), liveDir);
	const updateSrc = join(src, 'timspicks_update');
	add('php', 'update.php', join(updateSrc, 'update.php'), updateDir);
	for (const path of files.filter((name) => !name.startsWith('assets/') && name !== 'index.html' && !PHP_FIRST.includes(name))) add('rest', path, join(out, path), liveDir);
	// The update folder's other tracked files are refreshed where they're deployed, and never added
	for (const path of walk(updateSrc).filter((name) => name !== 'update.php' && isFile(join(updateDir, name)))) add('rest', path, join(updateSrc, path), updateDir);

	// Asset files from older builds, which nothing loads once the new index.html is in place
	const inUse = new Set(frontEndLive ? twins.values() : assets);
	const stale = liveAssets.filter((path) => !inUse.has(path));

	say(`Front end: ${frontEndLive ? `already live, version ${liveVersion ?? version}` : `live ${liveVersion ?? 'unknown'}, deploying ${version}`}`);
	if (!plan.length) {
		say(`Nothing to copy; the live and update folders already match ${branch} (${plural(unchanged, 'file')} checked)`);
	} else {
		say(`${options.dryRun ? 'Would copy' : 'Copying'}, in this order (${plural(unchanged, 'file')} already match):`);
		plan.forEach((item, index) => say(`  ${index + 1}. ${item.path} into the ${item.where}`));
	}
	if (options.dryRun) {
		if (stale.length) say(`Would remove ${plural(stale.length, 'older asset file')} once the new index.html is in place: ${stale.join(', ')}`);
		say('Dry run: nothing was copied');
		return;
	}

	// Copy. The front end goes first, assets before the index that names them; then the library, the book list
	// and update.php back to back, in a quiet part of the minute; then the rest
	for (const item of plan.filter(({ group }) => group === 'front')) place(item.from, item.to);
	const php = plan.filter(({ group }) => group === 'php');
	if (php.length) {
		const now = Date.now();
		const minute = now - (now % 60000);
		const second = (now % 60000) / 1000;
		if (second < QUIET_FROM || second >= QUIET_UNTIL) {
			const until = minute + QUIET_FROM * 1000 + (second >= QUIET_UNTIL ? 60000 : 0);
			say(`Waiting ${Math.ceil((until - now) / 1000)} s, so the PHP lands after this minute's cron run has loaded its own`);
			sleep(until - Date.now());
		}
		for (const item of php) place(item.from, item.to);
	}
	for (const item of plan.filter(({ group }) => group === 'rest')) place(item.from, item.to);

	// Check what landed: every copied file matches the build, and the live index loads only files that exist
	const wrong = plan.filter((item) => !sameBytes(item.from, item.to));
	if (wrong.length) stop(`These don't match the build after copying: ${wrong.map((item) => item.path).join(', ')}`);
	const missing = referencedBy(readText(join(liveDir, 'index.html'))).filter((path) => !isFile(join(liveDir, path)));
	if (missing.length) stop(`The live index.html loads ${missing.join(', ')}, which the live folder doesn't have`);
	if (plan.length) say(`Copied ${plural(plan.length, 'file')}; each one matches the build`);

	// Only after the deploy checks out: remove older asset files, but keep anything the live front end still
	// loads, whatever the build says
	if (stale.length) {
		const loaded = referencedBy(readText(join(liveDir, 'index.html')));
		const bundles = loaded.filter((path) => /\.(?:js|css)$/.test(path)).map((path) => readText(join(liveDir, path)) ?? '').join('\n');
		const pruned = stale.filter((path) => !loaded.includes(path) && !bundles.includes(basename(path)));
		for (const path of pruned) unlinkSync(join(liveDir, path));
		say(`Removed ${plural(pruned.length, 'older asset file')}${pruned.length < stale.length ? `; kept ${stale.length - pruned.length} the live front end still loads` : ''}`);
	}
	say(`Live front end: version ${versionOf(liveDir) ?? 'unknown'}`);
};

let status = 0;
try {
	deploy();
} catch (error) {
	console.error(error instanceof Stop ? error.message : `The deploy stopped: ${error?.stack ?? error}`);
	if (copied.length) console.error(`Copied before it stopped:\n${copied.map((path) => `  ${path}`).join('\n')}`);
	status = 1;
} finally {
	// Only this run's own build folder is removed
	if (Number(readText(join(BUILD_DIR, 'pid'))) === process.pid && relative(tmpdir(), resolve(BUILD_DIR)) === 'timspicks-deploy') {
		rmSync(BUILD_DIR, { recursive: true, force: true });
	}
}
process.exit(status);
