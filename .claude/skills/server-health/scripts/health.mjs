#!/usr/bin/env node
// Read-only health survey of the live server, for the server-health skill. It finds the cron line,
// the cron log, the update and live folders and the PHP error log by itself, then reports on the
// cron's runs, the live data and whether the deployed files match a git ref. The one thing it
// writes is a temp folder for building that ref, which it removes before exiting.
//
//   node .claude/skills/server-health/scripts/health.mjs [ref] [--days N] [--no-build]
//       [--update <dir>] [--lib <path>] [--log <file>] [--php-log <file>]
//
// The repo is public, so nothing here names a host or a path on the server. Everything is found at
// run time, and the report stays on the machine that runs it, with hosts masked.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	closeSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, statSync, symlinkSync,
	unlinkSync,
} from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

// --- Rules mirrored from the code they describe -------------------------------------------------

// timspicks_update/update.php: the cron's throttle
const UPDATE_PERIOD = 60 * 60 * 1000;
const RETRY_PERIOD = 5 * 60 * 1000;
const UPDATE_BUFFER = 60 * 1000;
// update.php calls backup() only after 3 a.m. ET, so the day's first snapshot can't come sooner
const BACKUP_HOUR = 3;
// src/dataProcessor.ts: when the app's status banner speaks up
const STALE_AFTER = 26 * 60 * 60 * 1000;
const RUN_GRACE = 10 * 60 * 1000;
const REDRAW_GRACE = 10 * 60 * 1000;

// This survey's own tolerances
const HOUR = 60 * 60 * 1000;
const DUE_SLACK = 5 * 60 * 1000; // a run due longer ago than this, plus one cron tick, is overdue
const LATE_FAIL = 30 * 60 * 1000; // overdue by more than this counts as failing
const GAP_LIMIT = 75 * 60 * 1000; // a longer gap between runs inside the run window is a missed hourly run
const CRON_GAP_LIMIT = 15 * 60 * 1000; // a longer silence in cron mail means cron itself didn't fire
const FLAG_HISTORY = 48 * HOUR; // older history is listed but not flagged
const TAIL_BYTES = 4 * 1024 * 1024; // how much of each log is read
const BIG_FILE = 1e9;
const BIG_LOGS = 50e9;
const LOW_DISK = 10e9;

const ET = 'America/New_York';
const NEVER_COPY = ['data', 'history', 'players', 'auth.json'];
const BOOKS = ['bet1', 'bet2', 'bet3', 'bet4'];
const SNAPSHOT_FILES = [...BOOKS.map((book) => `${book}.json`), 'helper.json'];
const LISTS = ['1', '2', '3'];

// --- Options ------------------------------------------------------------------------------------

const options = { ref: null, days: 7, build: true, update: null, lib: null, log: null, phpLog: null };
const ignored = [];
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
	const arg = args[index];
	const value = () => args[++index] ?? null;
	if (arg === '--days') options.days = Math.max(1, Math.floor(Number(value())) || 7);
	else if (arg === '--no-build') options.build = false;
	else if (arg === '--ref') options.ref = value();
	else if (arg === '--update') options.update = value();
	else if (arg === '--lib') options.lib = value();
	else if (arg === '--log') options.log = value();
	else if (arg === '--php-log') options.phpLog = value();
	else if (!arg.startsWith('-') && options.ref === null) options.ref = arg;
	else ignored.push(arg);
}

// --- Helpers ------------------------------------------------------------------------------------

const home = homedir();
const expand = (path) => (path ? resolve(path.replace(/^~(?=$|\/)/, home)) : null);
const run = (command, commandArgs, extra = {}) => execFileSync(command, commandArgs, {
	encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...extra,
});
const tryRun = (command, commandArgs, extra) => {
	try { return run(command, commandArgs, extra).replace(/\n$/, ''); } catch { return null; }
};
const git = (...gitArgs) => tryRun('git', gitArgs);
const statOf = (path) => { try { return statSync(path); } catch { return null; } };
const isFile = (path) => !!path && !!statOf(path)?.isFile();
const isDir = (path) => !!path && !!statOf(path)?.isDirectory();
const listDir = (path) => { try { return readdirSync(path); } catch { return []; } };
const readText = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
const parseJson = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
const readJson = (path) => parseJson(readText(path));
const realOr = (path) => { try { return realpathSync(path); } catch { return path; } };
const sameBytes = (a, b) => { try { return readFileSync(a).equals(readFileSync(b)); } catch { return false; } };
const clip = (text, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const few = (items, max = 8) => (items.length > max ? `${items.slice(0, max).join(', ')} and ${items.length - max} more` : items.join(', '));
const sizeOf = (bytes) => {
	if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
	if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 0 : 1)} MB`;
	return `${Math.ceil(bytes / 1e3)} KB`;
};
// Hosts stay out of the report, the way the docs leave them out; the path still says which feed it was
const maskHosts = (text) => text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s"'`<>]+/gi, '$1<host>');
// One key per kind of message: no hosts, no query strings, no long ids or timestamps
const normalize = (text) => maskHosts(text).replace(/\?[^\s"')]*/g, '').replace(/\d{5,}/g, '<n>').replace(/\s+/g, ' ').trim();
const median = (values) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null);

// The last `bytes` of a file, starting at a line boundary
const readTail = (path, bytes = TAIL_BYTES) => {
	try {
		const { size } = statSync(path);
		const start = Math.max(0, size - bytes);
		const buffer = Buffer.alloc(size - start);
		const fd = openSync(path, 'r');
		try { readSync(fd, buffer, 0, buffer.length, start); } finally { closeSync(fd); }
		const text = buffer.toString('utf8');
		return { text: start > 0 ? text.slice(text.indexOf('\n') + 1) : text, partial: start > 0, size };
	} catch {
		return null;
	}
};

// Counts items by kind, keeping when each kind was first and last seen, newest kind first
const groupBy = (items, keyOf) => {
	const groups = new Map();
	for (const item of items) {
		const key = keyOf(item);
		const group = groups.get(key) ?? { key, count: 0, first: item.time, last: item.time };
		group.count += 1;
		if (item.time < group.first) group.first = item.time;
		if (item.time > group.last) group.last = item.time;
		groups.set(key, group);
	}
	return [...groups.values()].sort((a, b) => b.last - a.last);
};

// Every file under a folder, as paths relative to it, skipping Finder's .DS_Store and some top-level names
const walk = (root, skipTop = []) => {
	const files = [];
	const visit = (dir, prefix) => {
		for (const name of listDir(dir)) {
			if (name === '.DS_Store' || (!prefix && skipTop.includes(name))) continue;
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

// --- Time: everything is reported in ET, the clock update.php runs on ---------------------------

const formatters = new Map();
const zonedParts = (date, timeZone) => {
	if (!formatters.has(timeZone)) {
		formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
			timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
		}));
	}
	const parts = {};
	for (const { type, value } of formatters.get(timeZone).formatToParts(date)) parts[type] = Number(value);
	return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute, second: parts.second };
};
// The instant a wall-clock time in a zone names; the second pass settles times near a clock change
const zonedTime = (year, month, day, hour, minute, second, timeZone) => {
	const wall = Date.UTC(year, month - 1, day, hour, minute, second);
	const offsetAt = (instant) => {
		const parts = zonedParts(new Date(instant), timeZone);
		return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant;
	};
	return new Date(wall - offsetAt(wall - offsetAt(wall)));
};
const pad = (number) => String(number).padStart(2, '0');
const etDay = (date) => { const parts = zonedParts(date, ET); return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`; };
const etHm = (date) => { const parts = zonedParts(date, ET); return `${pad(parts.hour)}${pad(parts.minute)}`; };
const etClock = (date) => { const parts = zonedParts(date, ET); return `${pad(parts.hour)}:${pad(parts.minute)}`; };
const etStamp = (date) => `${etDay(date)} ${etClock(date)}`;
const dayStart = (day) => {
	const [year, month, date] = day.split('-').map(Number);
	return zonedTime(year, month, date, 0, 0, 0, ET);
};
const shiftDay = (day, count) => {
	const [year, month, date] = day.split('-').map(Number);
	const shifted = new Date(Date.UTC(year, month - 1, date + count));
	return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
};
const span = (ms) => {
	const minutes = Math.round(Math.abs(ms) / 60000);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
	return `${Math.floor(hours / 24)} d${hours % 24 ? ` ${hours % 24} h` : ''}`;
};

const now = new Date();
const today = etDay(now);
const at = (date) => (date ? `${etStamp(date)} (${span(now - date)} ago)` : 'never');
const clockOrStamp = (date) => (etDay(date) === today ? etClock(date) : etStamp(date));
const dayAgo = new Date(now - 24 * HOUR);
const flagSince = new Date(now - FLAG_HISTORY);
const days = Array.from({ length: options.days }, (_, index) => shiftDay(today, -index));
const windowStart = dayStart(days.at(-1));

// --- Output -------------------------------------------------------------------------------------

const out = [];
const say = (text = '') => out.push(text);
const section = (title) => out.push('', `## ${title}`);
const attention = [];
const fail = (text) => attention.push({ level: 'FAIL', text });
const warn = (text) => attention.push({ level: 'WARN', text });
// A check that throws shouldn't take the rest of the report down with it
const guard = (name, check) => {
	try {
		check();
	} catch (error) {
		say(`(the ${name} check stopped: ${clip(String(error?.message ?? error), 140)})`);
		warn(`The ${name} check stopped early: ${clip(String(error?.message ?? error), 120)}`);
	}
};

// --- Locate: the cron line, then the folders it points at ---------------------------------------

process.chdir(git('rev-parse', '--show-toplevel') ?? process.cwd());
const repoRoot = process.cwd();
const processes = (tryRun('ps', ['-axww', '-o', 'command']) ?? '').split('\n');

const cronJobs = (tryRun('crontab', ['-l']) ?? '').split('\n').map((line) => line.trim())
	.filter((line) => line && !line.startsWith('#') && /\bupdate\.php\b/.test(line))
	.map((line) => {
		const macro = /^(@\w+)\s+(.*)$/.exec(line);
		const fields = line.split(/\s+/);
		const schedule = macro ? macro[1] : fields.slice(0, 5).join(' ');
		const command = macro ? macro[2] : fields.slice(5).join(' ');
		const url = /\bhttps?:\/\/[^\s"'<>]+/.exec(command)?.[0] ?? null;
		let lib = null;
		let urlPath = '/update.php';
		try {
			const parsed = new URL(url);
			lib = parsed.searchParams.get('lib');
			urlPath = parsed.pathname;
		} catch { /* no usable URL */ }
		const target = /(?:^|\s)>>?\s*("?)([^\s"]+)\1/.exec(command)?.[2] ?? null;
		return {
			line,
			schedule,
			// update.php's own default when the URL has no lib
			lib: lib ?? 'public',
			urlPath,
			// Cron runs from the home folder, so a relative log lands there
			log: target ? (target.startsWith('~') ? expand(target) : resolve(home, target)) : null,
		};
	});

// The web server's config names the folder each host serves
const webServerRunning = processes.some((line) => /\/(?:httpd|apache2|nginx)(?:\s|$)/.test(line));
const httpdLine = processes.find((line) => /\/(?:httpd|apache2)(?:\s|$)/.test(line)) ?? null;
const httpdConf = httpdLine ? (/\s-f\s*(.+?\.conf)(?=\s+-|\s*$)/.exec(httpdLine)?.[1] ?? null) : null;
const confFiles = httpdConf
	? [...new Set([httpdConf, ...[dirname(httpdConf), join(dirname(httpdConf), 'extra')]
		.flatMap((dir) => listDir(dir).filter((name) => name.endsWith('.conf')).map((name) => join(dir, name)))])]
	: [];
const confText = confFiles.map(readText).filter(Boolean).join('\n');
const documentRoots = [...new Set([...confText.matchAll(/^\s*DocumentRoot\s+"?([^"\n]+?)"?\s*$/gm)].map((match) => match[1]))];
const serverLogs = [...confText.matchAll(/^\s*ErrorLog\s+"?([^"\n|]+?)"?\s*$/gm)].map((match) => match[1]).filter((path) => path.startsWith('/'));

// The update folder holds update.php, and update.php loads fetch_lib.php from ../<lib>
const validUpdate = (dir, lib) => isFile(join(dir, 'update.php')) && isFile(join(dir, '..', lib, 'fetch_lib.php'));
// This checkout has its own timspicks_update/ beside public/, which is the source, not the deployed copy
const insideRepo = (dir) => !relative(repoRoot, realOr(dir)).startsWith('..');
const scanForUpdate = () => {
	const found = [];
	const queue = ['~/Sites', '~/public_html', '~/www', '/var/www', '/Library/WebServer/Documents'].map(expand).filter(isDir).map((dir) => [dir, 0]);
	while (queue.length) {
		const [dir, depth] = queue.shift();
		if (isFile(join(dir, 'update.php'))) found.push(dir);
		if (depth >= 3) continue;
		for (const name of listDir(dir)) {
			if (name.startsWith('.') || name === 'node_modules') continue;
			if (isDir(join(dir, name))) queue.push([join(dir, name), depth + 1]);
		}
	}
	return found;
};

let job = null;
let updateDir = null;
let updateHow = null;
let updateOthers = [];
// A line driving a local copy uses lib=public; prefer any other
const preferred = [...cronJobs].sort((a, b) => (a.lib === 'public') - (b.lib === 'public'));
if (options.update) {
	updateDir = expand(options.update);
	updateHow = '--update';
	job = preferred.find((candidate) => validUpdate(updateDir, options.lib ?? candidate.lib)) ?? preferred[0] ?? null;
} else {
	let scanned = null;
	for (const candidate of preferred.length ? preferred : [{ lib: options.lib, urlPath: '/update.php' }]) {
		const lib = options.lib ?? candidate.lib;
		if (!lib) continue;
		const urlDir = dirname(candidate.urlPath);
		let how = 'the web server config';
		let found = documentRoots.map((root) => join(root, urlDir)).filter((dir) => !insideRepo(dir) && validUpdate(dir, lib));
		if (!found.length) {
			scanned ??= scanForUpdate();
			found = scanned.filter((dir) => !insideRepo(dir) && validUpdate(dir, lib));
			how = 'a scan of the usual web folders';
		}
		found = [...new Set(found.map(realOr))];
		if (!found.length) continue;
		job = candidate.line ? candidate : null;
		[updateDir, ...updateOthers] = found;
		updateHow = how;
		break;
	}
	job ??= preferred[0] ?? null;
}
const lib = options.lib ?? job?.lib ?? null;
const liveDir = updateDir && lib ? resolve(updateDir, '..', lib) : null;
const dataDir = liveDir ? join(liveDir, 'data') : null;
const logPath = expand(options.log) ?? job?.log ?? null;

// Fatal errors never reach the cron log when PHP doesn't display them; they go to PHP's own log
const phpIni = processes.map((line) => /php(?:-cgi|-fpm)\S*\s.*?-c\s+(.+?\.ini)(?=\s|$)/.exec(line)?.[1]).find(Boolean) ?? null;
const iniErrorLog = phpIni ? (/^\s*error_log\s*=\s*"?([^"\n;]+?)"?\s*$/m.exec(readText(phpIni) ?? '')?.[1] ?? null) : null;
const phpLog = [expand(options.phpLog), iniErrorLog, ...serverLogs.map((path) => join(dirname(path), 'php_error.log'))].find(isFile) ?? null;
const folderErrorLogs = [updateDir, liveDir].filter(Boolean).map((dir) => join(dir, 'error_log')).filter(isFile);
// Cron mails whatever a run prints to stderr, which is where a curl failure ends up
const mailPath = [`/var/mail/${userInfo().username}`, `/var/spool/mail/${userInfo().username}`].find(isFile) ?? null;
const serverLogDir = serverLogs.length ? dirname(serverLogs[0]) : phpLog ? dirname(phpLog) : null;

section('Paths');
say(`Checkout: ${repoRoot}, on ${git('symbolic-ref', '--short', '-q', 'HEAD') ?? 'a detached HEAD'}`);
say(`Cron line: ${job ? maskHosts(job.line) : '(none calls update.php)'}`);
for (const other of cronJobs.filter((candidate) => candidate !== job)) say(`Other cron line: ${maskHosts(other.line)}`);
say(`Cron log: ${logPath ?? '(the cron line keeps no log; pass --log <file>)'}`);
say(`Web server config: ${httpdConf ?? '(no running web server named its config)'}`);
say(`Update folder: ${updateDir ? `${updateDir}, from ${updateHow}` : '(not found; pass --update <dir>)'}`);
if (updateOthers.length) say(`Also matched: ${updateOthers.join(', ')}`);
say(`Live folder: ${liveDir ?? '(unknown without the update folder)'}`);
say(`PHP error log: ${phpLog ?? '(not found; pass --php-log <file>)'}`);
say(`Cron mail: ${mailPath ?? '(none)'}`);
if (ignored.length) say(`Ignored arguments: ${ignored.join(' ')}`);

if (!cronJobs.length) fail('No cron line calls update.php, so nothing updates the live data');
if (!updateDir) fail('The update folder wasn\'t found; rerun with --update <dir>');
else if (!lib || !validUpdate(updateDir, lib)) fail(`${updateDir} has no update.php, or no fetch_lib.php at ../${lib ?? '<lib>'}`);
if (updateOthers.length) warn(`More than one update folder matched; this report checks ${updateDir}`);
if (liveDir && !isDir(liveDir)) fail(`The live folder ${liveDir} doesn't exist`);

// --- The cron log: one line per run that did work -----------------------------------------------

const LOG_LINE = /^\*\*\* (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) ([AP]M): ?(.*)$/;
const SNAPSHOT_PATH = /\/data\/\d{4}-\d{2}-\d{2}\/\d{4}$/;
const logTail = logPath ? readTail(logPath) : null;
const runs = [];
const unexpected = [];
for (const line of (logTail?.text ?? '').split(/\r?\n/)) {
	if (!line.trim()) continue;
	const match = LOG_LINE.exec(line);
	if (!match) {
		unexpected.push({ line, after: runs.at(-1)?.time ?? null });
		continue;
	}
	const [, year, month, day, hour, minute, half, message] = match;
	const time = zonedTime(Number(year), Number(month), Number(day), (Number(hour) % 12) + (half === 'PM' ? 12 : 0), Number(minute), 0, ET);
	// A run ends on a snapshot path, a "Complete" line or a step's "written to" line; anything else is a step's error
	const ok = SNAPSHOT_PATH.test(message) || /^Complete\b/.test(message) || /\b(?:has|have) been (?:merged and )?written to /.test(message);
	runs.push({ time, message, ok });
}
// The log covers a day when its first run comes before that day starts
const logCovers = (day) => runs.length > 0 && runs[0].time <= dayStart(day);

// A day's schedule: the live games.json while it holds today, otherwise the copy saved with that day's snapshots
const scheduleOf = (gamesJson) => {
	const week = gamesJson?.gameWeek?.[0];
	const games = (Array.isArray(week?.games) ? week.games : []).filter((game) => !isNaN(new Date(game?.startTimeUTC)));
	games.sort((a, b) => new Date(a.startTimeUTC) - new Date(b.startTimeUTC));
	return { day: typeof week?.date === 'string' ? week.date : null, games, times: games.map((game) => new Date(game.startTimeUTC)) };
};
const liveGames = dataDir ? readJson(join(dataDir, 'games.json')) : null;
const liveSchedule = scheduleOf(liveGames);
const scheduleFor = (day) => {
	if (day === today && liveSchedule.day === today) return liveSchedule;
	const saved = dataDir ? readJson(join(dataDir, day, 'games.json')) : null;
	return saved ? scheduleOf(saved) : null;
};

section('Cron');
guard('cron', () => {
	say(`Web server: ${webServerRunning ? 'running' : 'not running'}`);
	if (!webServerRunning) fail('No web server process is running, so the cron\'s calls never reach update.php');
	if (job && job.schedule !== '* * * * *') warn(`The cron runs on "${job.schedule}", but update.php expects a call every minute and throttles itself`);

	if (!logTail) {
		if (logPath) fail(`The cron log can't be read at ${logPath}`);
		else warn('The cron line doesn\'t append to a log, so there is no run history');
	} else {
		const last = runs.at(-1);
		const lastOk = runs.findLast((entry) => entry.ok);
		say(`Cron log: ${sizeOf(logTail.size)}, ${plural(runs.length, 'run')}${logTail.partial ? ' in its last 4 MB' : ''}${runs.length ? `, from ${etStamp(runs[0].time)}` : ''}`);
		say(`Last run: ${last ? `${at(last.time)}, ${last.ok ? 'ok' : 'failed'}: ${clip(maskHosts(last.message), 120)}` : 'none'}`);
		say(`Last success: ${lastOk ? at(lastOk.time) : 'none in the log'}`);

		const failed = runs.filter((entry) => !entry.ok && entry.time >= windowStart);
		const recentFailed = failed.filter((entry) => entry.time >= dayAgo);
		if (last && !last.ok) fail(`The latest cron run failed, ${at(last.time)}: ${clip(normalize(last.message), 140)}`);
		else if (recentFailed.length) warn(`${plural(recentFailed.length, 'cron run')} failed in the last 24 h, the latest ${at(recentFailed.at(-1).time)}: ${clip(normalize(recentFailed.at(-1).message), 120)}`);
		say(`Failed runs: ${recentFailed.length} in the last 24 h, ${failed.length} in the last ${options.days} days`);
		for (const group of groupBy(failed, (entry) => normalize(entry.message)).slice(0, 8)) {
			say(`    ${group.count} × ${clip(group.key, 120)}, ${etStamp(group.first)} to ${etStamp(group.last)}`);
		}

		// The latest unbroken run of failures, and how often it retried
		const lastFailed = runs.findLastIndex((entry) => !entry.ok);
		if (lastFailed >= 0 && runs[lastFailed].time >= windowStart) {
			let first = lastFailed;
			while (first > 0 && !runs[first - 1].ok) first -= 1;
			const streak = runs.slice(first, lastFailed + 1);
			const ongoing = lastFailed === runs.length - 1;
			const typical = median(streak.slice(1).map((entry, index) => entry.time - streak[index].time));
			say(`Latest failure streak: ${plural(streak.length, 'run')}, ${etStamp(streak[0].time)} to ${etStamp(streak.at(-1).time)}${typical === null ? '' : `, about every ${span(typical)}`}${ongoing ? ', still going' : ''}`);
			if (streak.length >= 5 && typical !== null && typical <= 90 * 1000 && streak.at(-1).time >= dayAgo) {
				warn(`The cron retried every minute through ${plural(streak.length, 'failed run')}, so the failed-run gate isn't holding`);
			}
		}

		// Two runs in one minute means two calls got past the gate together, which nothing guards against
		const minutes = new Map();
		for (const entry of runs.filter((item) => item.time >= windowStart)) minutes.set(entry.time.getTime(), (minutes.get(entry.time.getTime()) ?? 0) + 1);
		const doubled = [...minutes].filter(([, count]) => count > 1).map(([time]) => new Date(time));
		if (doubled.length) {
			say(`Minutes with two or more runs: ${few(doubled.map(etStamp), 5)}`);
			if (doubled.some((time) => time >= flagSince)) warn(`Two cron runs landed in the same minute, at ${few(doubled.filter((time) => time >= flagSince).map(etStamp), 3)}; they can overwrite each other's files`);
		}

		if (unexpected.length) {
			const recent = unexpected.filter((entry) => entry.after && entry.after >= dayAgo);
			say(`Unexpected output: ${plural(unexpected.length, 'line')} that aren't run lines, ${recent.length} in the last 24 h`);
			for (const entry of unexpected.slice(-3)) say(`    after ${entry.after ? etStamp(entry.after) : 'the start'}: ${clip(maskHosts(entry.line), 120)}`);
			if (recent.length) warn(`The cron log has ${plural(recent.length, 'line')} of unexpected output in the last 24 h, usually PHP output or an error page`);
		}

		// Runs per day, and gaps inside each day's run window: from the midnight buffer to the last start
		say('');
		say('Day         Runs  Failed  Gaps over 75 min between midnight and the last start');
		for (const day of days) {
			if (!logCovers(day) && !runs.some((entry) => etDay(entry.time) === day)) {
				say(`${day}  before the log starts`);
				continue;
			}
			const begin = dayStart(day);
			const end = dayStart(shiftDay(day, 1));
			const dayRuns = runs.filter((entry) => entry.time >= begin && entry.time < end);
			const schedule = scheduleFor(day);
			const gaps = [];
			if (schedule?.times.length) {
				const open = new Date(begin.getTime() + UPDATE_BUFFER);
				const close = new Date(Math.min(schedule.times.at(-1).getTime() - UPDATE_BUFFER, now.getTime()));
				const points = [open, ...dayRuns.map((entry) => entry.time).filter((time) => time > open && time < close), close];
				for (let index = 1; index < points.length; index += 1) {
					if (points[index] - points[index - 1] > GAP_LIMIT) gaps.push(`${etClock(points[index - 1])} to ${etClock(points[index])}`);
				}
			}
			const failedThatDay = dayRuns.filter((entry) => !entry.ok).length;
			// Not flagged on its own: a manual update resets the hourly clock without a cron log line, and the
			// failures behind a real gap show up as a cron silence, a PHP error or an overdue run
			say(`${day}  ${String(dayRuns.length).padStart(4)}  ${String(failedThatDay).padStart(6)}  ${gaps.length ? gaps.join(', ') : schedule?.times.length ? 'none' : 'no games on file'}`);
		}
	}

	// Cron mail: one message per run while curl prints its progress meter, so a silence means cron didn't fire
	say('');
	if (!mailPath) {
		say('Cron mail: none, so curl failures and cron silences can\'t be checked');
	} else {
		const mail = readTail(mailPath);
		const chunks = (mail?.text ?? '').split(/^From \S+ .*$/m);
		if (mail?.partial) chunks.shift();
		const messages = [];
		for (const chunk of chunks) {
			if (!/^Subject: .*\bupdate\.php\b/m.test(chunk)) continue;
			const time = new Date(/^Date: (.*)$/m.exec(chunk)?.[1] ?? '');
			if (isNaN(time)) continue;
			const body = chunk.slice(Math.max(0, chunk.search(/\n[ \t]*\n/)));
			messages.push({ time, errors: [...body.matchAll(/(?:curl: \(\d+\)|(?:\/bin\/)?sh: )[^\r\n]*/g)].map((match) => match[0].trim()) });
		}
		messages.sort((a, b) => a.time - b.time);
		const reach = messages[0]?.time ?? null;
		const lastDay = messages.filter((message) => message.time >= dayAgo);
		// Cron sometimes fires the job twice in one minute; the throttle absorbs the extra call unless a run is due
		const perMinute = new Map();
		for (const message of lastDay) {
			const minute = Math.floor(message.time / 60000);
			perMinute.set(minute, (perMinute.get(minute) ?? 0) + 1);
		}
		const twice = [...perMinute.values()].filter((count) => count > 1).length;
		say(`Cron mail: ${sizeOf(mail?.size ?? 0)}, ${plural(messages.length, 'run')} in its last 4 MB${reach ? `, back to ${etStamp(reach)}` : ''}`);
		say(`Cron runs in the last 24 h: ${lastDay.length} across ${plural(perMinute.size, 'minute')}${twice ? `, ${twice} of them with two calls` : ''}`
			+ `${reach && reach > dayAgo ? `; the mail read only reaches back ${span(now - reach)}` : ''}`);

		const typical = median(messages.slice(1).map((message, index) => message.time - messages[index].time));
		if (typical !== null && typical <= 90 * 1000) {
			const silences = [];
			for (let index = 1; index < messages.length; index += 1) {
				const gap = messages[index].time - messages[index - 1].time;
				if (gap > CRON_GAP_LIMIT) silences.push({ from: messages[index - 1].time, to: messages[index].time, gap });
			}
			const sinceLast = messages.length ? now - messages.at(-1).time : 0;
			if (sinceLast > CRON_GAP_LIMIT) silences.push({ from: messages.at(-1).time, to: null, gap: sinceLast });
			say(`Times cron didn't fire for over 15 min: ${silences.length ? '' : 'none'}`);
			for (const silence of silences.slice(-5)) say(`    ${etStamp(silence.from)} to ${silence.to ? etStamp(silence.to) : 'now'}, ${span(silence.gap)}`);
			if (sinceLast > CRON_GAP_LIMIT) fail(`Cron hasn't run update.php for ${span(sinceLast)}; the machine may be asleep or cron stopped`);
			else if (silences.some((silence) => silence.to >= flagSince)) warn(`Cron didn't fire for over 15 min at least once in the last 48 h; see Cron`);
		} else if (messages.length) {
			say('Cron mail isn\'t sent on every run, so it can\'t show when cron didn\'t fire');
		}

		const curlErrors = messages.flatMap((message) => message.errors.map((text) => ({ time: message.time, text })));
		const recentCurl = curlErrors.filter((error) => error.time >= dayAgo);
		say(`curl errors: ${recentCurl.length} in the last 24 h, ${curlErrors.length} in the mail read`);
		for (const group of groupBy(curlErrors, (error) => normalize(error.text)).slice(0, 5)) say(`    ${group.count} × ${clip(group.key, 120)}, last ${etStamp(group.last)}`);
		if (messages.at(-1)?.errors.length) fail(`The latest cron call failed in curl: ${clip(normalize(messages.at(-1).errors[0]), 120)}`);
		else if (recentCurl.length) warn(`curl failed ${plural(recentCurl.length, 'time')} in the last 24 h, the latest ${at(recentCurl.at(-1).time)}`);
	}

	// PHP's own log, filtered to entries about the live and update folders
	say('');
	// A folder path counts only as a whole path, not as the tail of a longer one
	const escapePattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const folderPattern = (dirs) => new RegExp(`(?<![\\w.~-])(?:${[...new Set(dirs.flatMap((dir) => [dir, realOr(dir)]))].map(escapePattern).join('|')})/`, 'g');
	const folders = [
		...(updateDir && isFile(join(updateDir, 'update.php')) ? [{ pattern: folderPattern([updateDir]), label: '<update>/' }] : []),
		...(liveDir && isFile(join(liveDir, 'fetch_lib.php')) ? [{ pattern: folderPattern([liveDir]), label: '<live>/' }] : []),
	];
	if (!phpLog) {
		say('PHP error log: not found, so fatal errors in update.php can\'t be checked');
		warn('The PHP error log wasn\'t found; fatal errors in the cron runs only show up there. Pass --php-log <file>');
	} else if (!folders.length) {
		say('PHP error log: skipped, since the live and update folders weren\'t found');
	} else {
		const tail = readTail(phpLog);
		const mentionsFolder = (line) => folders.some(({ pattern }) => { pattern.lastIndex = 0; return pattern.test(line); });
		const shorten = (text) => folders.reduce((result, { pattern, label }) => result.replace(pattern, label), text);
		const PHP_LINE = /^\[(\d{2})-([A-Z][a-z]{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([^\]]+)\] (.*)$/;
		const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const entries = [];
		let current = null;
		for (const line of (tail?.text ?? '').split(/\r?\n/)) {
			const match = PHP_LINE.exec(line);
			if (match) {
				current = { stamp: match.slice(1, 8), text: match[8], lines: [match[8]] };
				entries.push(current);
			} else if (current && line.trim()) {
				current.lines.push(line);
			}
		}
		// Only now work out times, for the entries that matter; the stamp carries PHP's zone, which may not be ET
		const ours = entries.filter((entry) => entry.lines.some(mentionsFolder)).map((entry) => {
			const [dd, mon, yyyy, hh, mi, ss, zone] = entry.stamp;
			const fields = [Number(yyyy), MONTHS.indexOf(mon) + 1, Number(dd), Number(hh), Number(mi), Number(ss)];
			let time;
			try { time = zonedTime(...fields, zone.trim()); } catch { time = new Date(Date.UTC(fields[0], fields[1] - 1, ...fields.slice(2))); }
			return { ...entry, time };
		}).filter((entry) => entry.time >= windowStart);
		const isFatal = (entry) => /PHP (?:Fatal|Parse) error/.test(entry.text);
		say(`PHP errors from the live and update folders, last ${options.days} days:${ours.length ? '' : ' none'}`);
		for (const group of groupBy(ours, (entry) => shorten(normalize(entry.text))).slice(0, 8)) {
			say(`    ${group.count} × ${clip(group.key, 130)}, ${etStamp(group.first)} to ${etStamp(group.last)}`);
		}
		if (tail?.partial && entries[0]) say(`    (the last 4 MB of the log, back to ${entries[0].stamp.slice(0, 3).join('-')})`);
		const fatals = ours.filter(isFatal);
		const latestFatal = fatals.at(-1);
		if (latestFatal && latestFatal.time >= dayAgo) fail(`PHP logged ${plural(fatals.filter((entry) => entry.time >= dayAgo).length, 'fatal error')} from the live or update folder in the last 24 h, the latest ${at(latestFatal.time)}: ${clip(shorten(normalize(latestFatal.text)), 120)}`);
		else if (latestFatal && latestFatal.time >= flagSince) warn(`PHP logged a fatal error from the live or update folder ${at(latestFatal.time)}: ${clip(shorten(normalize(latestFatal.text)), 120)}`);
		const recentWarnings = ours.filter((entry) => !isFatal(entry) && entry.time >= dayAgo);
		if (recentWarnings.length) warn(`PHP logged ${plural(recentWarnings.length, 'warning')} from the live or update folder in the last 24 h; see Cron`);
	}
	for (const path of folderErrorLogs) {
		say(`Also an error_log file: ${path}, ${sizeOf(statOf(path).size)}, changed ${at(statOf(path).mtime)}`);
		warn(`PHP is writing an error_log file at ${path}`);
	}
});

// --- Data: the live data folder, read the way the app and the cron read it -----------------------

section('Data');
guard('data', () => {
	if (!liveDir || !isDir(liveDir)) {
		say('Skipped: the live folder wasn\'t found');
		return;
	}
	if (!isDir(dataDir)) {
		fail(`The live data folder is missing: ${dataDir}`);
		return;
	}
	const proc = readJson(join(dataDir, 'process.json'));
	const timeOf = (value) => (typeof value === 'string' && !isNaN(new Date(value)) ? new Date(value) : null);
	const processed = timeOf(proc?.processed);
	const started = timeOf(proc?.started);
	const failingSince = timeOf(proc?.failingSince);
	const runWarnings = Array.isArray(proc?.warnings) ? proc.warnings.filter((warning) => typeof warning === 'string') : [];
	if (!processed) fail('process.json is missing or has no valid "processed" time, so the site can\'t say when data was updated');
	say(`Last complete run: ${at(processed)}`);
	if (started && (!processed || started > processed)) say(`Unfinished run: started ${at(started)}${failingSince ? `, failing since ${at(failingSince)}` : ''}`);
	say(`Warnings from the last run: ${runWarnings.length ? '' : 'none'}`);
	for (const warning of runWarnings.slice(0, 8)) say(`    ${clip(maskHosts(warning), 140)}`);

	const helper = readJson(join(dataDir, 'helper.json'));
	const schedule = liveSchedule;
	const todays = schedule.day === today ? schedule.times : null;
	const lastStart = schedule.times.at(-1) ?? null;
	const gamesLeft = !!todays?.some((time) => time > now);
	const drawn = typeof helper?.dateTimeAvailable === 'string' ? helper.dateTimeAvailable : null;

	// The banner, as getDataStatus() and App.tsx decide it
	const bannerStarted = failingSince ?? started;
	const unfinished = !!(processed && bannerStarted && bannerStarted > processed && now - bannerStarted > RUN_GRACE);
	const stopped = !!(processed && now - processed > STALE_AFTER);
	const staleBanner = !!(processed && lastStart && schedule.times.some((time) => time < lastStart && time > processed && now - time > REDRAW_GRACE));
	const earlierDraw = drawn !== null && schedule.day !== null && drawn.slice(0, 10) !== schedule.day;
	const dayLocked = !!(lastStart && now >= lastStart && !stopped);
	const notices = [];
	if (!schedule.games.length) notices.push('no games listed, so the site shows none');
	if (dayLocked) notices.push('all of today\'s games have started, so picks are locked (normal at this hour)');
	if (unfinished || stopped || ((staleBanner || earlierDraw) && !dayLocked)) {
		const text = unfinished ? 'The latest update didn\'t finish'
			: stopped ? 'There hasn\'t been an update in over a day'
				: earlierDraw ? 'Today\'s pick lists haven\'t posted yet'
					: 'A game has started since the last update';
		notices.push(text);
		(unfinished || stopped ? fail : warn)(`The site's banner says: ${text}`);
	}
	if (runWarnings.length) {
		notices.push(`${plural(runWarnings.length, 'warning')} from the last update`);
		warn(`The site's banner lists ${plural(runWarnings.length, 'warning')} from the last update`);
	}
	say(`Site banner now: ${notices.length ? notices.join('; ') : 'none'}`);

	// update.php's staleList(): a listed team whose game started more than one buffer ago
	const startedTeams = new Map();
	for (const game of todays ? schedule.games : []) {
		if ((game.gameScheduleState ?? 'OK') !== 'OK') continue;
		const time = new Date(game.startTimeUTC);
		if (time > now - UPDATE_BUFFER) continue;
		for (const abbrev of [game.awayTeam?.abbrev, game.homeTeam?.abbrev]) if (abbrev) startedTeams.set(abbrev, time);
	}
	const listed = LISTS.flatMap((key) => (Array.isArray(helper?.[key]) ? helper[key] : []));
	const staleTeams = [...new Set(listed.map((row) => row?.team).filter((team) => startedTeams.has(team)))];
	const earlierDrawCron = drawn !== null && drawn.slice(0, 10) !== today;

	// When update.php's gate next lets a run through
	const midnight = dayStart(today);
	const failedDate = started && (!processed || started > processed) ? started : null;
	const lastRunDate = failedDate ?? processed;
	let due = null;
	let dueNote;
	if (now - midnight <= UPDATE_BUFFER) dueNote = 'inside the midnight buffer';
	else if (!todays) {
		due = failedDate && now - failedDate < UPDATE_PERIOD ? new Date(failedDate.getTime() + UPDATE_PERIOD) : new Date(midnight.getTime() + UPDATE_BUFFER);
		dueNote = `games.json holds ${schedule.day ?? 'no'} schedule, so the next call runs in full`;
	} else if (!todays.length) dueNote = 'no games today, so the cron has nothing to update';
	else if (now >= todays.at(-1) - UPDATE_BUFFER) dueNote = 'the day\'s last game has started, so the cron rests until midnight';
	else if (!lastRunDate) {
		due = new Date(midnight.getTime() + UPDATE_BUFFER);
		dueNote = 'no recorded run, so every call runs';
	} else {
		const inGameWindow = now >= todays[0] - UPDATE_PERIOD;
		const inRollover = now < midnight.getTime() + UPDATE_PERIOD;
		const retry = (inGameWindow && (failedDate || staleTeams.length)) || (inRollover && earlierDrawCron);
		const startAfter = todays.find((time) => time >= lastRunDate);
		due = new Date(Math.min(lastRunDate.getTime() + (retry ? RETRY_PERIOD : UPDATE_PERIOD), startAfter ? startAfter.getTime() + UPDATE_BUFFER : Infinity));
		dueNote = retry ? 'retrying every 5 min' : 'hourly, or right after a game starts';
	}
	if (due && now - due - 60 * 1000 > DUE_SLACK) {
		say(`Next run: overdue, due ${clockOrStamp(due)}, ${span(now - due)} ago (${dueNote})`);
		(now - due > LATE_FAIL ? fail : warn)(`A cron run was due at ${clockOrStamp(due)} and hasn't landed, ${span(now - due)} late${todays ? '' : `; games.json still holds ${schedule.day ?? 'no'} schedule`}`);
	} else if (due) {
		say(`Next run: ${due > now ? `due ${clockOrStamp(due)}, in ${span(due - now)}` : 'due now'} (${dueNote})`);
	} else {
		say(`Next run: none due (${dueNote})`);
	}

	// Today's feeds
	if (!liveGames) fail('games.json is missing or unreadable, so the site has no schedule');
	const state = (game) => ((game.gameScheduleState ?? 'OK') === 'OK' ? '' : ` ${game.gameScheduleState}`);
	say(`Schedule: ${schedule.day ?? 'unreadable'}${schedule.day && schedule.day !== today ? `, not today (${today})` : ''}, ${plural(schedule.games.length, 'game')}`);
	if (schedule.games.length) say(`    ${schedule.games.map((game) => `${etClock(new Date(game.startTimeUTC))} ${game.awayTeam?.abbrev ?? '?'}@${game.homeTeam?.abbrev ?? '?'}${state(game)}`).join(', ')}`);
	if (!helper) {
		fail('helper.json is missing or unreadable, so the site has no pick lists');
	} else {
		const sizes = LISTS.map((key) => (Array.isArray(helper[key]) ? helper[key].length : 0));
		say(`Pick lists: ${sizes.join(' / ')}, ${drawn ? `drawn ${drawn.replace('T', ' ').slice(0, 16)} ET` : 'no draw stamp'}`);
		if (gamesLeft && sizes.some((size) => size === 0)) warn(`A pick list is empty while today's games remain: ${sizes.join(' / ')}`);
		if (staleTeams.length && !dayLocked) {
			const oldest = new Date(Math.min(...staleTeams.map((team) => startedTeams.get(team))));
			say(`    Still lists teams whose games have started: ${few(staleTeams)}`);
			if (now - oldest > REDRAW_GRACE) warn(`helper.json still lists ${few(staleTeams)}, whose games started ${span(now - oldest)} ago`);
		}
	}
	const books = [];
	for (const book of BOOKS) {
		const path = join(dataDir, `${book}.json`);
		const offers = readJson(path);
		if (!Array.isArray(offers)) {
			fail(`${book}.json is missing or unreadable`);
			books.push(`${book} unreadable`);
			continue;
		}
		books.push(`${book} ${offers.length}`);
		if (!offers.length && gamesLeft) warn(`${book}.json is empty while today's games remain`);
		const modified = statOf(path)?.mtime;
		if (processed && modified && processed - modified > 10 * 60 * 1000) warn(`${book}.json wasn't rewritten by the last complete run; it last changed ${at(modified)}`);
	}
	say(`Books: ${books.join(', ')}`);

	// The app loads players/<id>.json for every listed player, and one missing file fails the whole load
	const ids = [...new Set(listed.map((row) => row?.playerId).filter((id) => Number.isInteger(id) && id > 0))];
	const missing = ids.filter((id) => !isFile(join(liveDir, 'players', `${id}.json`)));
	say(`Player files: ${ids.length - missing.length} of ${plural(ids.length, 'listed player')}${missing.length ? `, missing ${few(missing.map(String))}` : ''}`);
	if (missing.length) fail(`${plural(missing.length, 'listed player')} ${missing.length === 1 ? 'has' : 'have'} no players/<id>.json, and the site fails to load without one`);

	// Never printed: only whether the admin page has something to check a sign-in against
	const auth = readJson(join(liveDir, 'auth.json'));
	const authOk = typeof auth?.name === 'string' && typeof auth?.code === 'string';
	say(`auth.json: ${authOk ? 'present, with a name and a hash' : 'missing or malformed'}`);
	if (!authOk) warn('auth.json is missing or malformed, so the admin page can\'t sign anyone in');

	// Snapshots: one folder per distinct ET start time, written by runs before that start (backup() in fetch_lib.php)
	say('');
	say('Snapshots, one folder per game start time:');
	for (const day of days) {
		const dayDir = join(dataDir, day);
		const folders = listDir(dayDir).filter((name) => /^\d{4}$/.test(name)).sort();
		const daySchedule = scheduleFor(day);
		const flag = day === today || dayStart(day) >= dayStart(etDay(flagSince));
		if (!daySchedule?.times.length) {
			if (folders.length) say(`${day}: ${folders.join(' ')}, with no schedule saved`);
			else if (runs.some((entry) => etDay(entry.time) === day)) say(`${day}: no games (the cron ran, and wrote no snapshot)`);
			else if (day !== today && logCovers(day)) {
				say(`${day}: no snapshots and no cron output`);
				if (flag) warn(`No cron output and no snapshots on ${day}`);
			} else say(`${day}: no snapshots${day === today ? ' yet' : ''}`);
			continue;
		}
		const firstTimes = new Map();
		for (const time of daySchedule.times) if (!firstTimes.has(etHm(time))) firstTimes.set(etHm(time), time);
		const slots = [...firstTimes.keys()].sort();
		const written = [];
		const pending = [];
		const problems = [];
		slots.forEach((slot, index) => {
			const startTime = firstTimes.get(slot);
			// The first slot waits for the first run after 3 a.m.; each later one for the run just after the previous start
			const dueBy = index === 0
				? new Date(Math.min(dayStart(day).getTime() + BACKUP_HOUR * HOUR + 70 * 60 * 1000, startTime.getTime()))
				: new Date(firstTimes.get(slots[index - 1]).getTime() + REDRAW_GRACE);
			if (folders.includes(slot)) {
				written.push(slot);
				const lacking = SNAPSHOT_FILES.filter((file) => !isFile(join(dayDir, slot, file)));
				if (lacking.length) {
					problems.push(`${slot} lacks ${lacking.join(', ')}`);
					if (flag) warn(`Snapshot ${day}/${slot} lacks ${lacking.join(', ')}`);
				}
			} else if (now < dueBy) {
				pending.push(slot);
			} else if (now >= startTime) {
				problems.push(`${slot} never written`);
				if (flag) warn(`Snapshot ${day}/${slot} was never written before its ${etClock(startTime)} start`);
			} else {
				problems.push(`${slot} overdue since ${etClock(dueBy)}`);
				warn(`Snapshot ${day}/${slot} should exist by now: due ${etClock(dueBy)}, game at ${etClock(startTime)}`);
			}
		});
		const extra = folders.filter((folder) => !slots.includes(folder));
		say(`${day}: ${written.length} of ${slots.length}${written.length ? `, ${written.join(' ')}` : ''}`
			+ `${pending.length ? `; not due yet: ${pending.join(' ')}` : ''}${problems.length ? `; ${problems.join('; ')}` : ''}`
			+ `${extra.length ? `; also ${extra.join(' ')}, not in the schedule` : ''}`);
	}
});

// --- Deploy: the live and update folders against a build of the ref -------------------------------

const refName = options.ref ?? 'origin/main';
section(`Deploy, live against ${refName}`);
guard('deploy', () => {
	if (!liveDir || !isDir(liveDir) || !updateDir) {
		say('Skipped: the live or update folder wasn\'t found');
		return;
	}
	let ref = refName;
	let sha = git('rev-parse', '--verify', '-q', `${ref}^{commit}`);
	if (!sha && !options.ref) {
		ref = 'main';
		sha = git('rev-parse', '--verify', '-q', 'main^{commit}');
		if (sha) say('origin/main isn\'t here, so this compares against local main');
	}
	if (!sha) {
		say(`Skipped: ${refName} doesn't exist in this checkout`);
		fail(`The ref ${refName} doesn't exist in this checkout, so the deployed files weren't compared`);
		return;
	}
	const refVersion = parseJson(git('show', `${sha}:package.json`))?.version ?? null;
	say(`Reference: ${ref} at ${sha.slice(0, 7)} "${git('log', '-1', '--format=%s', sha)}", package version ${refVersion ?? 'unknown'}`);
	if (ref.startsWith('origin/')) {
		const fetched = statOf(git('rev-parse', '--git-path', 'FETCH_HEAD') ?? '')?.mtime;
		say(`Remote refs last fetched: ${fetched ? at(fetched) : 'never'}`);
	}
	const counts = git('rev-list', '--left-right', '--count', 'main...origin/main');
	if (counts) {
		const [ahead, behind] = counts.split(/\s+/).map(Number);
		say(`Local main: ${ahead || behind ? `${ahead} ahead of and ${behind} behind origin/main` : 'same as origin/main'}`);
	}
	const branch = git('symbolic-ref', '--short', '-q', 'HEAD');
	if (branch && branch !== 'main') say(`This checkout is on ${branch}; work there isn't live until it's released, so it isn't compared`);

	const work = mkdtempSync(join(tmpdir(), 'server-health-'));
	const linked = join(work, 'src', 'node_modules');
	try {
		const src = join(work, 'src');
		const outDir = join(work, 'out');
		mkdirSync(src);
		run('git', ['archive', '--format=tar', `--output=${join(work, 'ref.tar')}`, sha]);
		run('tar', ['-xf', join(work, 'ref.tar'), '-C', src]);

		// Build the ref the way the deploy does, into the temp folder: dist/ and the working tree stay untouched
		let built = false;
		let buildNote;
		const vite = join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
		if (!options.build) buildNote = 'skipped (--no-build)';
		else if (!isFile(vite)) buildNote = 'skipped, since node_modules is missing';
		else {
			symlinkSync(join(repoRoot, 'node_modules'), linked, 'dir');
			const begin = Date.now();
			try {
				run(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd: src, timeout: 5 * 60 * 1000 });
				built = isFile(join(outDir, 'index.html'));
				buildNote = built ? `built in ${((Date.now() - begin) / 1000).toFixed(1)} s` : 'the build wrote no index.html';
			} catch (error) {
				buildNote = `failed: ${clip(String(error.stderr || error.message).trim().split('\n')[0], 140)}`;
			}
		}
		say(`Reference build: ${buildNote}`);
		if (options.build && !built) warn(`The reference build of ${ref} ${buildNote.replace(/^skipped/, 'was skipped')}, so the front end was checked by version only`);

		// The live folder, without the four things a deploy never copies
		const expectedRoot = built ? outDir : join(src, 'public');
		const expected = walk(expectedRoot, NEVER_COPY);
		const live = walk(liveDir, NEVER_COPY);
		const liveSet = new Set(live);
		const stateOf = (path) => (!liveSet.has(path) ? 'missing' : sameBytes(join(expectedRoot, path), join(liveDir, path)) ? 'same' : 'differs');
		const states = new Map(expected.map((path) => [path, stateOf(path)]));

		// The bundler names a script after the folder it was built in as well as its contents, so the same
		// code gets a different name here than in the deploy checkout. Match assets by their bytes instead,
		// then hold index.html against the live one with those names swapped in.
		const twins = new Map();
		if (built) {
			const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
			const liveByDigest = new Map(live.filter((path) => path.startsWith('assets/')).map((path) => [digest(join(liveDir, path)), path]));
			for (const path of expected) {
				if (!path.startsWith('assets/') || states.get(path) === 'same') continue;
				const twin = liveByDigest.get(digest(join(expectedRoot, path)));
				if (!twin) continue;
				twins.set(path, twin);
				states.set(path, 'same');
			}
			if (states.get('index.html') === 'differs' && twins.size) {
				let index = readText(join(expectedRoot, 'index.html')) ?? '';
				for (const [path, twin] of twins) index = index.replaceAll(path, twin);
				if (index === readText(join(liveDir, 'index.html'))) states.set('index.html', 'same');
			}
		}
		const expectedSet = new Set([...expected, ...twins.values()]);
		const withState = (wanted) => expected.filter((path) => states.get(path) === wanted).map((path) => twins.get(path) ?? path);
		const liveIndex = readText(join(liveDir, 'index.html')) ?? '';
		const referenced = [...liveIndex.matchAll(/\s(?:src|href)="(?:\.\/)?([^"#?]+)"/g)].map((match) => match[1]).filter((path) => !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path));
		const bundles = referenced.filter((path) => /\.(?:js|css)$/.test(path)).map((path) => readText(join(liveDir, path)) ?? '').join('\n');
		const isFrontEnd = (path) => path === 'index.html' || path.startsWith('assets/');
		// Without a build there is nothing to hold the live front end against, so only its version speaks for it
		const extras = live.filter((path) => !expectedSet.has(path) && (built || path !== 'index.html'));
		const inUse = (path) => referenced.includes(path) || bundles.includes(path.split('/').pop());
		const liveBuild = built ? extras.filter((path) => path.startsWith('assets/') && inUse(path)) : [];
		const leftovers = extras.filter((path) => path.startsWith('assets/') && !inUse(path));
		const strays = extras.filter((path) => !isFrontEnd(path));

		say(`Live folder, leaving out ${NEVER_COPY.join(', ')}${built ? '' : '; the front end is checked by version only'}:`);
		say(`    same: ${withState('same').length ? few(withState('same')) : 'none'}`);
		if (withState('differs').length) say(`    differs: ${few(withState('differs'))}`);
		if (withState('missing').length) say(`    missing: ${few(withState('missing'))}`);
		if (withState('missing').some((path) => path.endsWith('.js'))) say('    (script names are from the temp build; the deploy checkout\'s build names them differently)');
		if (liveBuild.length) say(`    in the live build but not ${ref}'s: ${few(liveBuild)}`);
		if (leftovers.length) say(`    older build files nothing loads: ${plural(leftovers.length, 'file')}, harmless`);
		if (strays.length) say(`    other files not in ${ref}: ${few(strays)}`);

		const broken = referenced.filter((path) => !isFile(join(liveDir, path)));
		if (!liveIndex) fail('The live folder has no index.html');
		else if (broken.length) fail(`The live index.html points at ${few(broken)}, which ${broken.length === 1 ? 'doesn\'t' : 'don\'t'} exist, so the site can't load`);

		// The info popup's version is compiled into the bundle, next to the word "Version"
		const versionIn = (text) => /Version ?[`'"]\s*,\s*[`'"](\d+\.\d+\.\d+)[`'"]/.exec(text ?? '')?.[1] ?? null;
		const liveVersion = referenced.filter((path) => path.endsWith('.js')).map((path) => versionIn(readText(join(liveDir, path)))).find(Boolean) ?? null;
		say(`Front-end version: live ${liveVersion ?? 'unknown'}, ${ref} ${refVersion ?? 'unknown'}`);
		const versionBehind = !!(liveVersion && refVersion && liveVersion !== refVersion);
		const frontEndChanged = built ? expected.some((path) => isFrontEnd(path) && states.get(path) !== 'same') : versionBehind;
		if (frontEndChanged) {
			warn(`The live front end ${versionBehind ? `is ${liveVersion}, while ${ref} is ${refVersion}` : `doesn't match ${ref}'s build`}`);
			if (!versionBehind && built) say(`    Same version, different build: it came from another commit, or node_modules differs from ${ref}'s lockfile`);
		}
		const lockKey = (text) => {
			const lock = parseJson(text);
			if (!lock) return null;
			delete lock.version;
			if (lock.packages?.['']) delete lock.packages[''].version;
			return JSON.stringify(lock);
		};
		if (built && lockKey(git('show', `${sha}:package-lock.json`)) !== lockKey(readText(join(repoRoot, 'package-lock.json')))) {
			say(`    Note: the build used this checkout's node_modules, whose lockfile differs from ${ref}'s`);
		}
		const serverFiles = expected.filter((path) => !isFrontEnd(path) && states.get(path) !== 'same');
		for (const path of serverFiles) {
			const gone = states.get(path) === 'missing';
			(gone && path.endsWith('.php') ? fail : warn)(`${path} in the live folder ${gone ? 'is missing' : `differs from ${ref}`}`);
		}

		// The update folder: only update.php is deployed; the seeder files stay local, so they're compared when present
		const updateRoot = join(src, 'timspicks_update');
		const updateExpected = walk(updateRoot);
		const updateLive = walk(updateDir);
		say('Update folder:');
		const updateChanged = [];
		for (const path of updateExpected) {
			if (!updateLive.includes(path)) {
				if (path === 'update.php') {
					say(`    missing: ${path}`);
					fail('update.php is missing from the update folder');
					updateChanged.push(path);
				} else say(`    not deployed: ${path}, which is fine; it stays local`);
				continue;
			}
			const same = sameBytes(join(updateRoot, path), join(updateDir, path));
			say(`    ${same ? 'same' : 'differs'}: ${path}`);
			if (!same) {
				warn(`${path} in the update folder differs from ${ref}`);
				updateChanged.push(path);
			}
		}
		const updateExtras = updateLive.filter((path) => !updateExpected.includes(path));
		if (updateExtras.length) say(`    other files: ${few(updateExtras)}`);

		// What to copy, in the order docs/deployment.md gives
		const steps = [];
		if (frontEndChanged) steps.push(`On a checkout of ${ref}: git pull, npm install if dependencies changed, then npm run build. Copy dist/assets/* into the live folder, and after that dist/index.html.`);
		for (const path of serverFiles) steps.push(`Copy public/${path} into the live folder.`);
		for (const path of updateChanged) steps.push(`Copy timspicks_update/${path} into the update folder${path === 'update.php' && serverFiles.length ? ', after the live folder\'s PHP' : ''}.`);
		say(`Copy list:${steps.length ? '' : ` nothing; the live files match ${ref}`}`);
		steps.forEach((step, index) => say(`    ${index + 1}. ${step}`));
		say(`Never copy: ${NEVER_COPY.map((name) => `dist/${name}`).join(', ')}; the server owns them`);
	} finally {
		// Unlink the node_modules link first, so removing the temp folder can't reach the checkout's own
		try { unlinkSync(linked); } catch { /* never linked */ }
		rmSync(work, { recursive: true, force: true });
	}
});

// --- Server: room to keep running ---------------------------------------------------------------

section('Server');
guard('server', () => {
	const row = tryRun('df', ['-k', liveDir && isDir(liveDir) ? liveDir : home])?.split('\n')[1]?.trim().split(/\s+/);
	if (row && Number(row[1]) > 0) {
		const total = Number(row[1]) * 1024;
		const available = Number(row[3]) * 1024;
		say(`Disk: ${sizeOf(available)} free of ${sizeOf(total)}`);
		if (available < LOW_DISK || available / total < 0.05) fail(`The disk holding the live folder has only ${sizeOf(available)} free`);
		else if (available / total < 0.1) warn(`The disk holding the live folder is over 90% full, ${sizeOf(available)} free`);
	}
	if (serverLogDir) {
		const files = listDir(serverLogDir).map((name) => ({ name, info: statOf(join(serverLogDir, name)) })).filter(({ info }) => info?.isFile())
			.map(({ name, info }) => ({ name, size: info.size })).sort((a, b) => b.size - a.size);
		const total = files.reduce((sum, file) => sum + file.size, 0);
		const big = files.filter((file) => file.size >= BIG_FILE);
		say(`Web server logs: ${sizeOf(total)} in ${serverLogDir}${big.length ? `; largest ${big.slice(0, 4).map((file) => `${file.name} ${sizeOf(file.size)}`).join(', ')}` : ''}`);
		if (total >= BIG_LOGS) warn(`The web server's log folder holds ${sizeOf(total)}, ${files[0].name} alone ${sizeOf(files[0].size)}`);
	}
	if (mailPath) say(`Cron mail spool: ${sizeOf(statOf(mailPath)?.size ?? 0)}`);
});

// --- Report ---------------------------------------------------------------------------------------

const fails = attention.filter((item) => item.level === 'FAIL');
const warns = attention.filter((item) => item.level === 'WARN');
const verdict = fails.length ? 'Failing' : warns.length ? 'Needs attention' : 'Healthy';
console.log([
	`# Server health, ${etStamp(now)} ET`,
	'',
	`Verdict: ${verdict}`,
	'',
	'## Attention',
	...(attention.length ? [...fails, ...warns].map((item) => `- ${item.level} ${item.text}`) : ['(none)']),
	...out,
].join('\n'));
