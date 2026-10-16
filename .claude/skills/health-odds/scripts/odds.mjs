#!/usr/bin/env node
// Odds feed check for the health-odds skill. It pulls bet1–bet4 fresh through a fetch_lib.php, into a
// folder of its own with every raw response saved, then checks each parsed file against the responses
// it came from: which market each entry was read from, whether that market is the anytime goal scorer
// one, and whether a market the parser should have read went unread. Then it compares prices across
// the books and against the live files, and runs the app's own name matchers, loaded from src/, over
// today's pick lists and the season's snapshots.
//
//   node .claude/skills/health-odds/scripts/odds.mjs [--out <dir>] [--no-pull] [--days N | --all]
//       [--lib <fetch_lib.php>] [--live <dir>] [--php <path>]
//
// It writes only into --out, plus a cache folder it removes. The repo is public, so nothing here names
// a host or a path on the server: both are found at run time, and the report masks hosts.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ET = 'America/New_York';
const BOOKS = ['bet1', 'bet2', 'bet3', 'bet4'];
const LISTS = ['1', '2', '3'];

// This check's own tolerances
const SAME_PRICE = 1e-6; // relative: the parser copies a price, or works it out the same way the raw one is
const BOOK_BIAS = 1.33; // a book's median price this far from the others' is likely another market
const SPREAD = 1.6; // one player's prices this far apart across the books are worth a look
const MOVED = 1.25; // a live price this far from the pull's has moved, or came from somewhere else
const SEASON_BREAK = 60; // days: a longer gap between snapshot days separates two seasons
const SHOW = 8; // how many examples a line lists

// --- Options ------------------------------------------------------------------------------------

const options = { out: null, pull: true, days: null, all: false, lib: null, live: null, php: null };
const ignored = [];
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
	const arg = args[index];
	const value = () => args[++index] ?? null;
	if (arg === '--out') options.out = value();
	else if (arg === '--no-pull') options.pull = false;
	else if (arg === '--days') options.days = Math.max(1, Math.floor(Number(value())) || 1);
	else if (arg === '--all') options.all = true;
	else if (arg === '--lib') options.lib = value();
	else if (arg === '--live') options.live = value();
	else if (arg === '--php') options.php = value();
	else ignored.push(arg);
}

// --- Helpers ------------------------------------------------------------------------------------

const home = homedir();
const expand = (path) => (path ? resolve(path.replace(/^~(?=$|\/)/, home)) : null);
const run = (command, commandArgs, extra = {}) => spawnSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 1 << 28, ...extra });
const tryRun = (command, commandArgs) => {
	const result = run(command, commandArgs);
	return result.status === 0 ? result.stdout.replace(/\n$/, '') : null;
};
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
const few = (items, max = SHOW) => (items.length > max ? `${items.slice(0, max).join(', ')} and ${items.length - max} more` : items.join(', '));
// Hosts stay out of the report, the way the docs leave them out; the path still says which feed it was
const maskHosts = (text) => text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s"'`<>]+/gi, '$1<host>');
const push = (map, key, value) => {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
};
const median = (values) => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const num = (value) => (typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN);
const samePrice = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= SAME_PRICE * Math.max(1, Math.abs(a));
const price = (odds) => (Number.isFinite(odds) ? String(Number(odds.toFixed(odds >= 10 ? 1 : 2))) : '-');
const times = (ratio) => `×${ratio.toFixed(2)}`;
const beyond = (ratio, limit) => ratio > limit || ratio < 1 / limit;
const quoteList = (names) => names.map((name) => `"${name}"`).join(', ');

// Damerau-Levenshtein distance, for spotting a name spelled another way
const distance = (a, b) => {
	const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)));
	for (let i = 1; i <= a.length; i += 1) {
		for (let j = 1; j <= b.length; j += 1) {
			rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
		}
	}
	return rows[a.length][b.length];
};

// --- Time: everything is reported in ET, the clock the cron runs on -----------------------------

const clockFormat = new Intl.DateTimeFormat('en-US', {
	timeZone: ET, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
const etParts = (date) => Object.fromEntries(clockFormat.formatToParts(date).map(({ type, value }) => [type, value]));
const etDay = (date) => { const parts = etParts(date); return `${parts.year}-${parts.month}-${parts.day}`; };
const etClock = (date) => { const parts = etParts(date); return `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`; };
const etStamp = (date) => `${etDay(date)} ${etClock(date)}`;
const span = (ms) => {
	const minutes = Math.round(Math.abs(ms) / 60000);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
	return `${Math.floor(hours / 24)} d${hours % 24 ? ` ${hours % 24} h` : ''}`;
};
const utcDay = (day) => Date.UTC(...day.split('-').map((part, index) => Number(part) - (index === 1 ? 1 : 0)));
const shiftDay = (day, count) => new Date(utcDay(day) + count * 86400000).toISOString().slice(0, 10);
const now = new Date();
const today = etDay(now);

// --- Output -------------------------------------------------------------------------------------

const out = [];
const say = (text = '') => out.push(text);
const section = (title) => out.push('', `## ${title}`);
const attention = [];
const fail = (text) => attention.push({ level: 'FAIL', text });
const warn = (text) => attention.push({ level: 'WARN', text });
// A check that throws shouldn't take the rest of the report down with it
const guard = async (name, check) => {
	try {
		await check();
	} catch (error) {
		say(`(the ${name} check stopped: ${clip(String(error?.stack ?? error), 400)})`);
		warn(`The ${name} check stopped early: ${clip(String(error?.message ?? error), 120)}`);
	}
};

// --- Locate: the checkout, the live folder, a PHP to run the parser with ------------------------

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = tryRun('git', ['-C', scriptDir, 'rev-parse', '--show-toplevel']) ?? resolve(scriptDir, '..', '..', '..', '..');
process.chdir(repoRoot);
const processes = (tryRun('ps', ['-axww', '-o', 'command']) ?? '').split('\n').map((line) => line.trim());
const insideRepo = (dir) => !relative(repoRoot, realOr(dir)).startsWith('..');

// The route health-server takes: the cron line names update.php's URL and its lib, the running web
// server's config maps that URL to the update folder, and the live folder is lib beside it
const findLive = () => {
	if (options.live) return { dir: expand(options.live), how: '--live' };
	const jobs = (tryRun('crontab', ['-l']) ?? '').split('\n').map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#') && /\bupdate\.php\b/.test(line))
		.map((line) => {
			try {
				const url = new URL(/\bhttps?:\/\/[^\s"'<>]+/.exec(line)?.[0]);
				return { lib: url.searchParams.get('lib') ?? 'public', urlDir: dirname(url.pathname) };
			} catch {
				return null;
			}
		})
		.filter(Boolean)
		// A line driving a local copy uses lib=public; prefer any other
		.sort((a, b) => (a.lib === 'public') - (b.lib === 'public'));
	const httpdLine = processes.find((line) => /\/(?:httpd|apache2)(?:\s|$)/.test(line)) ?? null;
	const conf = httpdLine ? (/\s-f\s*(.+?\.conf)(?=\s+-|\s*$)/.exec(httpdLine)?.[1] ?? null) : null;
	const confFiles = conf
		? [conf, ...[dirname(conf), join(dirname(conf), 'extra')].flatMap((dir) => listDir(dir).filter((name) => name.endsWith('.conf')).map((name) => join(dir, name)))]
		: [];
	const confText = [...new Set(confFiles)].map(readText).filter(Boolean).join('\n');
	const roots = [...new Set([...confText.matchAll(/^\s*DocumentRoot\s+"?([^"\n]+?)"?\s*$/gm)].map((match) => match[1]))];
	const valid = (dir, lib) => !insideRepo(dir) && isFile(join(dir, 'update.php')) && isFile(join(dir, '..', lib, 'fetch_lib.php'));
	for (const job of jobs) {
		for (const root of roots) {
			const dir = join(root, job.urlDir);
			if (valid(dir, job.lib)) return { dir: realOr(resolve(dir, '..', job.lib)), how: 'the cron line and the web server config' };
		}
	}
	const queue = ['~/Sites', '~/public_html', '~/www', '/var/www', '/Library/WebServer/Documents'].map(expand).filter(isDir).map((dir) => [dir, 0]);
	while (queue.length) {
		const [dir, depth] = queue.shift();
		for (const job of jobs) if (valid(dir, job.lib)) return { dir: realOr(resolve(dir, '..', job.lib)), how: 'a scan of the usual web folders' };
		if (depth >= 3) continue;
		for (const name of listDir(dir)) {
			if (!name.startsWith('.') && name !== 'node_modules' && isDir(join(dir, name))) queue.push([join(dir, name), depth + 1]);
		}
	}
	return null;
};

// A PHP 8 CLI: --php, else one on PATH, else the CLI beside the CGI binary the web server runs
const findPhp = () => {
	const candidates = [];
	if (options.php) candidates.push(expand(options.php));
	const onPath = tryRun('/bin/sh', ['-c', 'command -v php']);
	if (onPath) candidates.push(onPath);
	for (const line of processes) {
		const binary = /^(\S*\/php-(?:cgi|fpm)[\w.-]*)(?:\s|$)/.exec(line)?.[1];
		if (binary) candidates.push(join(dirname(binary), 'php'), join(dirname(binary), '..', 'bin', 'php'));
	}
	for (const path of [...new Set(candidates)]) {
		if (!isFile(path)) continue;
		const version = /^PHP (\d+)\.(\d+)\.(\d+)/.exec(tryRun(path, ['-v']) ?? '');
		if (version && Number(version[1]) >= 8) return { path: realOr(path), version: version.slice(1).join('.') };
	}
	return null;
};

const live = findLive();
const liveDir = live && isDir(live.dir) ? live.dir : null;
// Without the live folder, the checkout's own copies under public/ stand in, as far as they go
const dataRoot = liveDir ?? join(repoRoot, 'public');
const php = findPhp();
const lib = expand(options.lib) ?? join(repoRoot, 'public', 'fetch_lib.php');
const liveLib = liveDir ? join(liveDir, 'fetch_lib.php') : null;
const shortPath = (path) => (path.startsWith(`${repoRoot}/`) ? relative(repoRoot, path) : path);

let outDir = expand(options.out);
if (!options.pull && !outDir) {
	console.error('--no-pull needs --out <a folder an earlier run pulled into>');
	process.exit(2);
}
if (options.pull) {
	if (!outDir) outDir = mkdtempSync(join(tmpdir(), 'health-odds-'));
	else if (listDir(outDir).length) {
		console.error(`${outDir} isn't empty. Pass a new folder, or --no-pull to check what it holds.`);
		process.exit(2);
	}
	mkdirSync(outDir, { recursive: true });
}

// --- Pull ---------------------------------------------------------------------------------------

const pullScript = join(scriptDir, 'pull.php');
const runPull = (libPath, dir) => {
	const started = new Date();
	const result = run(php.path, [pullScript, libPath, dir], { timeout: 4 * 60 * 1000 });
	const steps = {};
	for (const line of (result.stdout ?? '').split('\n')) {
		const parsed = parseJson(line);
		if (parsed?.step) steps[parsed.step] = parsed;
	}
	const record = {
		when: started.toISOString(),
		lib: libPath,
		steps,
		stderr: (result.stderr ?? '').trim(),
		failure: result.error ? String(result.error.message) : result.status !== 0 ? `exited with ${result.status ?? result.signal}` : null,
	};
	writeFileSync(join(dir, 'pull.json'), `${JSON.stringify(record, null, '\t')}\n`);
	return record;
};

let pull = null;
let livePull = null;
let lintNote = null;
if (options.pull) {
	if (!php) fail('No PHP 8 CLI was found, so nothing was pulled; pass --php <path>');
	else if (!isFile(lib)) fail(`There's no fetch_lib.php at ${lib}, so nothing was pulled`);
	else {
		const lint = run(php.path, ['-l', lib]);
		lintNote = lint.status === 0 ? 'lints clean' : `doesn't lint: ${clip(`${lint.stdout ?? ''}${lint.stderr ?? ''}`.trim(), 240)}`;
		if (lint.status !== 0) fail(`${shortPath(lib)} ${lintNote}`);
		else {
			pull = runPull(lib, outDir);
			// The live folder can run another parser than this checkout's, so it gets a pull of its own
			if (liveLib && isFile(liveLib) && !sameBytes(lib, liveLib)) {
				const liveOut = join(outDir, 'live-lib');
				mkdirSync(liveOut, { recursive: true });
				livePull = runPull(liveLib, liveOut);
			}
		}
	}
} else {
	pull = readJson(join(outDir, 'pull.json'));
	livePull = readJson(join(outDir, 'live-lib', 'pull.json'));
}
const pulledAt = pull?.when ? new Date(pull.when) : statOf(join(outDir, 'bet1.json'))?.mtime ?? now;

// --- The app's own code, loaded from src/ the way the browser runs it ---------------------------

let app = null;
let appError = null;
let viteServer = null;
const cacheDir = mkdtempSync(join(tmpdir(), 'health-odds-cache-'));
// The app's normalization, as removeAccentsNormalize in src/dataProcessor.ts; the real one replaces it once src/ loads
let appFold = (name) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
try {
	const { createServer } = await import('vite');
	viteServer = await createServer({
		root: repoRoot,
		configFile: join(repoRoot, 'vite.config.ts'),
		cacheDir,
		logLevel: 'error',
		clearScreen: false,
		appType: 'custom',
		server: { middlewareMode: true, hmr: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] },
	});
	const processor = await viteServer.ssrLoadModule('/src/dataProcessor.ts');
	const { Player } = await viteServer.ssrLoadModule('/src/components/Table.tsx');
	const { Sportsbooks } = await viteServer.ssrLoadModule('/src/dataTypes.ts');
	app = { processor, Player, titles: Object.fromEntries(BOOKS.map((book) => [book, Sportsbooks?.[book]?.title ?? null])) };
	appFold = processor.removeAccentsNormalize;
} catch (error) {
	appError = clip(String(error?.message ?? error), 300);
}
const title = (book) => (app?.titles?.[book] ? `${book} (${app.titles[book]})` : book);

// Looser than the app's, for spotting one name spelled two ways: no accents, case or punctuation, and
// no suffix like "(CAR)" or "#40" that a book adds to tell two players apart
const looseFold = (name) => appFold(String(name)).replace(/[’‘`´]/g, "'").replace(/\([^)]*\)|#\d+/g, ' ').replace(/\./g, '')
	.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (text) => ` ${looseFold(text).replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
// The map read backwards turns a book's spelling into the roster name, so the books' prices line up
const reverseMap = new Map(app ? [...app.processor.oddsNameMap].map(([roster, odds]) => [odds, roster]) : []);
const canonical = (name) => appFold(reverseMap.get(name) ?? name);
const validItems = (items) => (Array.isArray(items) ? items.filter((item) => item && typeof item.name === 'string' && typeof item.odds === 'number') : []);

// --- Today's schedule ---------------------------------------------------------------------------

const scheduleFile = [join(outDir, 'games.json'), join(dataRoot, 'data', 'games.json')].find(isFile) ?? null;
const scheduleDay = readJson(scheduleFile)?.gameWeek?.[0] ?? null;
const games = (scheduleDay?.games ?? []).map((game) => {
	const team = (side) => ({ code: side?.abbrev ?? '?', name: side?.commonName?.default ?? '' });
	const away = team(game.awayTeam);
	const homeTeam = team(game.homeTeam);
	const start = new Date(game.startTimeUTC);
	return { id: String(game.id), away, home: homeTeam, start, label: `${away.code}@${homeTeam.code}`, started: start <= pulledAt };
});
const gameByTeam = new Map(games.flatMap((game) => [[game.away.code, game], [game.home.code, game]]));
// A book's own label for a game names both teams; the schedule's team names find it
const todayGame = (label) => {
	const text = words(label ?? '');
	return games.find((game) => game.away.name && game.home.name && text.includes(words(game.away.name)) && text.includes(words(game.home.name))) ?? null;
};

// --- What each book's raw responses hold ---------------------------------------------------------
// Each reader turns one book's saved responses into the same shape: markets, each in a game, each with
// the selections it prices. It reads every market there, not just the one the parser keeps, so the
// report can say where each parsed entry came from and what else was on offer.

const newMarket = (fields) => ({
	game: '', start: null, family: '', detail: '', files: [], selections: [], kept: 0,
	terms: { period: [], happening: [], line: [] }, ...fields,
});
const named = (...names) => [...new Set(names.filter((name) => typeof name === 'string' && name.trim()))];
const parameterValue = (parameters, key) => (Array.isArray(parameters) ? parameters.find((item) => item?.key === key)?.value : undefined);

const readers = {
	bet1(dir) {
		const raw = readJson(join(dir, 'src_bet1.json'));
		if (!raw) return { error: 'src_bet1.json is missing or not JSON' };
		if (!Array.isArray(raw.markets) || !Array.isArray(raw.selections)) {
			return { error: `src_bet1.json has no markets and selections lists (top level: ${Object.keys(raw).join(', ')})` };
		}
		const events = new Map((raw.events ?? []).map((event) => [String(event.id), event]));
		const markets = new Map();
		for (const item of raw.markets) {
			const event = events.get(String(item.eventId));
			const family = item.marketType?.name ?? item.name ?? '(unnamed)';
			markets.set(String(item.id), newMarket({
				game: event?.name ?? `event ${item.eventId}`,
				start: event?.startEventDate ?? null,
				family,
				detail: item.name && item.name !== family ? item.name : '',
				files: ['src_bet1.json'],
			}));
		}
		for (const item of raw.selections) {
			const market = markets.get(String(item.marketId));
			if (!market) continue;
			const participant = item.participants?.[0];
			const names = named(participant?.seoIdentifier, participant?.name, item.label);
			market.selections.push({ player: names[0] ?? '', names, odds: num(item.trueOdds ?? item.displayOdds?.decimal), side: item.outcomeType ?? '', market });
		}
		return { markets: [...markets.values()], notes: [] };
	},

	bet2(dir) {
		const files = listDir(dir).filter((name) => /^src_bet2_\d+\.json$/.test(name)).sort();
		if (!files.length) {
			return { error: readJson(join(dir, 'src_bet2.json')) ? 'no event pages were saved, so the parser fetched no games' : 'src_bet2.json is missing or not JSON' };
		}
		const markets = [];
		const notes = [];
		for (const file of files) {
			const attachments = readJson(join(dir, file))?.attachments;
			if (!attachments?.markets) {
				notes.push(`${file} has no attachments.markets`);
				continue;
			}
			const eventId = /\d+/.exec(file)[0];
			const event = attachments.events?.[eventId] ?? Object.values(attachments.events ?? {})[0];
			for (const item of Object.values(attachments.markets)) {
				const market = newMarket({
					game: event?.name ?? `event ${eventId}`,
					start: event?.openDate ?? null,
					family: item.marketName ?? '(unnamed)',
					detail: named(item.marketType, ...(Array.isArray(item.marketLevels) ? item.marketLevels : [])).join(', '),
					files: [file],
				});
				for (const runner of item.runners ?? []) {
					const odds = runner.winRunnerOdds?.trueOdds;
					const fraction = odds?.fractionalOdds;
					// Worked out the way the parser does, so the two compare exactly
					const decimal = fraction?.denominator ? fraction.numerator / fraction.denominator + 1 : num(odds?.decimalOdds?.decimalOdds);
					market.selections.push({ player: runner.runnerName ?? '', names: named(runner.runnerName), odds: decimal, side: '', market });
				}
				markets.push(market);
			}
		}
		return { markets, notes };
	},

	bet3(dir) {
		const files = listDir(dir).filter((name) => /^src_bet3_\d+\.json$/.test(name) && name !== 'src_bet3_0.json').sort();
		if (!files.length) {
			return { error: readJson(join(dir, 'src_bet3_0.json')) ? 'no fixture pages were saved, so the parser fetched no games' : 'src_bet3_0.json is missing or not JSON' };
		}
		const markets = [];
		const notes = [];
		for (const file of files) {
			const fixture = readJson(join(dir, file))?.fixture;
			if (!fixture) {
				notes.push(`${file} has no fixture`);
				continue;
			}
			const game = fixture.name?.value ?? file;
			const start = fixture.startDate ?? null;
			for (const item of fixture.optionMarkets ?? []) {
				const label = item.name?.value ?? '(unnamed)';
				const choices = item.options ?? [];
				// A market of its own per player names the player and prices a lone Yes, sometimes beside a No
				const own = /^(.+?) (to score\b.*)$/i.exec(label);
				const perPlayer = !!own && !/\bteams?\b/i.test(own[1]) && choices.length > 0 && choices.every((choice) => /^(yes|no)$/i.test(choice.name?.value ?? ''));
				const period = parameterValue(item.parameters, 'Period');
				const happening = parameterValue(item.parameters, 'Happening');
				const line = parameterValue(item.parameters, 'DecimalValue');
				const market = newMarket({
					game,
					start,
					family: perPlayer ? `<player> ${own[2]}` : label,
					detail: [happening && `happening ${happening}`, period && `period ${period}`, line !== undefined && `line ${Number(line)}`].filter(Boolean).join(', '),
					files: [file],
					terms: { period: named(period), happening: named(happening), line: line === undefined ? [] : [String(Number(line))] },
				});
				for (const choice of choices) {
					const name = choice.name?.value ?? '';
					if (perPlayer && !/^yes$/i.test(name)) continue;
					const player = perPlayer ? own[1] : name;
					market.selections.push({ player, names: named(player), odds: num(choice.price?.odds), side: perPlayer ? name : '', market });
				}
				markets.push(market);
			}
			// The older layout kept markets under games, each with results
			for (const item of fixture.games ?? []) {
				const market = newMarket({ game, start, family: item.name?.value ?? '(unnamed)', detail: 'games list', files: [file] });
				for (const result of item.results ?? []) {
					market.selections.push({ player: result.name?.value ?? '', names: named(result.name?.value), odds: num(result.odds), side: '', market });
				}
				markets.push(market);
			}
		}
		return { markets, notes };
	},

	bet4(dir) {
		const files = listDir(dir).filter((name) => /^src_bet4_\d+\.json$/.test(name))
			.sort((a, b) => Number(/\d+/.exec(a)[0]) - Number(/\d+/.exec(b)[0]));
		if (!files.length) return { error: 'no src_bet4 pages were saved' };
		const groups = new Map();
		const notes = [];
		let extra = 0;
		for (const file of files) {
			const items = readJson(join(dir, file))?.items;
			if (!Array.isArray(items)) {
				notes.push(`${file} has no items list`);
				continue;
			}
			for (const item of items) {
				const player = item.playerInfo?.name ?? '';
				const game = (item.eventInfo?.extendedFormatName ?? []).map((part) => part?.value).filter(Boolean).join(' ') || `event ${item.eventInfo?.id ?? '?'}`;
				// Older responses kept the closing time and odds on the item itself
				const offers = Array.isArray(item.betOffers) ? item.betOffers : [item];
				if (offers.length > 1 || (offers[0]?.outcomes?.length ?? 0) > 1) extra += 1;
				for (const offer of offers) {
					const family = offer.betDescription ?? offer.criterion?.label ?? offer.betOfferType ?? '(no description)';
					const key = `${game}\n${family}`;
					const market = groups.get(key) ?? newMarket({ game, start: offer.closingTime ?? null, family, files: [] });
					if (!market.files.includes(file)) market.files.push(file);
					for (const outcome of offer.outcomes ?? []) {
						const side = String(outcome.type ?? outcome.label ?? '?');
						market.selections.push({ player, names: named(player), odds: num(outcome.odds), side, line: outcome.line, offerType: offer.betOfferType ?? '', market });
						if (outcome.line !== undefined && !market.terms.line.includes(String(outcome.line))) market.terms.line.push(String(outcome.line));
					}
					groups.set(key, market);
				}
			}
		}
		for (const market of groups.values()) {
			market.detail = [...named(...market.selections.map((selection) => selection.offerType)), ...named(...market.selections.map((selection) => `${selection.side} line ${selection.line ?? '-'}`))].join(', ');
		}
		if (extra) notes.push(`${plural(extra, 'player')} carry more than one offer or outcome, and the parser reads only the first of each`);
		return { markets: [...groups.values()], notes, extra };
	},
};

// --- Telling the anytime market from the rest ---------------------------------------------------

const SCORER = /goal ?scorer|to score|\bscorer\b|or more goals|\d\+ goals?/i;
const ANYTIME = /\bany ?time\b|^to score\b|^<player> to score\b|\bto score (?:a|1|one)\b|\b(?:1|one) or more goals?\b|\b1\+ goals?\b/i;
const NOT_ANYTIME = /\b(?:first|1st|second|2nd|third|3rd|last|next|period|half|parlay|win|winner|regular time|power ?play|shots?|points?|assists?|empty net|hat ?trick|both teams|in house)\b|\b[2-9]\+|\b(?:[2-9]|two|three) or more\b|\bot goal|overtime goal/i;
const anytimeName = (family) => ANYTIME.test(family) && !NOT_ANYTIME.test(family);
// What a book states about how a market settles, where it states it: the whole game, a goal, one or more
const termProblems = (markets, selections) => {
	const problems = new Set();
	for (const market of markets) {
		for (const value of market.terms.period) if (!/^(full ?time|game|match)$/i.test(value)) problems.add(`period ${value}`);
		for (const value of market.terms.happening) if (!/goal/i.test(value)) problems.add(`settles on ${value}`);
		for (const value of market.terms.line) if (![0.5, 1].includes(Number(value))) problems.add(`line ${value}`);
	}
	for (const selection of selections) if (selection.side && !/^(yes|over|toscoreanytime)$/i.test(selection.side)) problems.add(`the ${selection.side} side`);
	return [...problems];
};
const gameWords = (label) => words(label).trim().split(' ').filter((word) => word.length > 3);
// Team markets price teams, or Yes and No; a player market prices players
const playerLevel = (market) => {
	const teamWords = gameWords(market.game);
	const names = market.selections.map((selection) => looseFold(selection.player));
	const teamish = names.filter((name) => !name || /^(yes|no|no goal|neither|none|over|under|tie|draw)\b/.test(name)
		|| teamWords.some((word) => ` ${name} `.includes(` ${word} `))).length;
	return names.length > 0 && teamish < names.length / 2;
};

// --- Each book: its parsed file against its raw responses ---------------------------------------

const books = BOOKS.map((key) => {
	const step = pull?.steps?.[key] ?? null;
	const file = join(outDir, `${key}.json`);
	const raw = readJson(file);
	const book = {
		key, step, exists: isFile(file), raw, entries: validItems(raw), invalid: Array.isArray(raw) ? raw.length - validItems(raw).length : null,
		markets: [], notes: [], readerError: null, extra: 0, unattributed: [], ambiguous: 0, families: [], byGame: new Map(), offSchedule: 0,
	};
	if (!book.exists) return book;
	let read;
	try {
		read = readers[key](outDir);
	} catch (error) {
		// A layout this reader doesn't expect is a finding, not a reason to stop the report
		read = { error: `the reader stopped: ${clip(String(error?.message ?? error), 160)}` };
	}
	book.readerError = read.error ?? null;
	book.markets = read.markets ?? [];
	book.notes = read.notes ?? [];
	book.extra = read.extra ?? 0;

	// Each parsed entry back to the raw selection with its name and price
	const index = new Map();
	for (const market of book.markets) {
		for (const selection of market.selections) {
			for (const name of selection.names) for (const indexKey of new Set([name, appFold(name)])) push(index, indexKey, selection);
		}
	}
	for (const entry of book.entries) {
		const hits = [...new Set([...(index.get(entry.name) ?? []), ...(index.get(appFold(entry.name)) ?? [])])].filter((selection) => samePrice(selection.odds, entry.odds));
		if (!hits.length) {
			book.unattributed.push(entry);
			continue;
		}
		if (new Set(hits.map((selection) => selection.market.family)).size > 1) book.ambiguous += 1;
		const hit = hits.find((selection) => anytimeName(selection.market.family)) ?? hits[0];
		hit.kept = true;
		hit.market.kept += 1;
		entry.market = hit.market;
		const game = todayGame(hit.market.game);
		if (game) push(book.byGame, game.id, entry);
		else book.offSchedule += 1;
	}

	// Markets grouped by kind, kept ones and the other scorer markets the parser left alone
	const families = new Map();
	for (const market of book.markets) {
		if (!market.kept && !(SCORER.test(market.family) && playerLevel(market))) continue;
		const family = families.get(market.family) ?? { name: market.family, markets: [], details: new Set(), games: new Map(), kept: 0, priced: 0 };
		family.markets.push(market);
		if (market.detail) family.details.add(market.detail);
		const game = todayGame(market.game);
		const gameKey = game?.id ?? market.game;
		const slot = family.games.get(gameKey) ?? { label: game?.label ?? clip(market.game, 40), game, priced: 0, kept: 0 };
		const priced = market.selections.filter((selection) => Number.isFinite(selection.odds) && selection.odds > 1).length;
		slot.priced += priced;
		slot.kept += market.kept;
		family.priced += priced;
		family.kept += market.kept;
		family.games.set(gameKey, slot);
		families.set(market.family, family);
	}
	for (const family of families.values()) {
		const keptSelections = family.markets.flatMap((market) => market.selections.filter((selection) => selection.kept));
		family.problems = termProblems(family.markets.filter((market) => market.kept || !family.kept), family.kept ? keptSelections : family.markets.flatMap((market) => market.selections));
		family.anytime = anytimeName(family.name) && !family.problems.length;
	}
	book.families = [...families.values()].sort((a, b) => b.kept - a.kept || b.priced - a.priced);
	return book;
});
const bookByKey = Object.fromEntries(books.map((book) => [book.key, book]));
// A book whose fetch failed has nothing to check; a reused folder without pull.json goes by its files
const pulled = (book) => (book.step ? !book.step.error && !book.step.thrown : book.exists);

// --- Report: setup and the pull -----------------------------------------------------------------

section('Setup');
say(`Checkout: ${repoRoot}, on ${tryRun('git', ['symbolic-ref', '--short', '-q', 'HEAD']) ?? 'a detached HEAD'}`);
say(`Live folder: ${liveDir ? `${liveDir}, from ${live.how}` : `(not found; pass --live <dir>). Names are checked against the checkout's public/ copies, which may be stale`}`);
say(`PHP: ${php ? `${php.path}, ${php.version}` : '(no PHP 8 CLI found; pass --php <path>)'}`);
const libNote = !liveLib || !isFile(liveLib) ? 'no live copy to compare'
	: sameBytes(lib, liveLib) ? 'the live copy is the same'
		: livePull ? 'the live copy differs, so it got a pull of its own' : 'the live copy differs';
say(`Parser: ${shortPath(lib)}${lintNote ? `, ${lintNote}` : ''}; ${libNote}`);
say(`Pull: ${outDir}${pull?.when ? `, ${etStamp(new Date(pull.when))}` : ''}${options.pull ? '' : ' (reused)'}`);
say(`App code: ${app ? 'src/dataProcessor.ts loaded, so names go through the app\'s own matchers' : `didn't load, so the name checks are skipped: ${appError}`}`);
if (ignored.length) say(`Ignored arguments: ${ignored.join(' ')}`);
if (!app) warn(`The app's code didn't load, so names weren't checked: ${clip(appError ?? '', 120)}`);

const shorten = (text) => maskHosts(String(text)).replaceAll(`${outDir}/`, '').replaceAll(outDir, '<out>');
section('Pull');
if (!pull) say(options.pull ? 'Nothing was pulled.' : `No pull.json in ${outDir}; reading the files there as they are.`);
else {
	if (pull.failure) fail(`The pull didn't finish: ${pull.failure}${pull.stderr ? `; ${clip(shorten(pull.stderr), 160)}` : ''}`);
	for (const step of ['games', ...BOOKS]) {
		const result = pull.steps?.[step];
		const name = step === 'games' ? 'games' : title(step);
		if (!result) {
			say(`${name}: no result`);
			continue;
		}
		const outcome = result.thrown ? `threw ${result.thrown}` : result.error ? `error: ${result.error}` : 'ok';
		const entries = step === 'games' ? '' : `, ${plural(bookByKey[step].entries.length, 'entry', 'entries')}`;
		say(`${name}: ${shorten(outcome)}, ${result.seconds} s${entries}`);
		for (const text of result.warning ?? []) say(`    warning: ${shorten(text)}`);
		for (const text of (result.notices ?? []).slice(0, 3)) say(`    notice: ${shorten(text)}`);
		if ((result.notices ?? []).length > 3) say(`    and ${(result.notices.length - 3)} more notices`);
		if (step === 'games') {
			if (result.thrown || result.error) warn(`The schedule didn't pull, so games come from ${scheduleFile ? shortPath(scheduleFile) : 'nowhere'}: ${clip(shorten(result.thrown ?? result.error), 120)}`);
			continue;
		}
		if (result.thrown) fail(`${title(step)}'s parser threw, which stops the cron's whole run: ${clip(shorten(result.thrown), 160)}`);
		else if (result.error) warn(`${title(step)} couldn't be checked, its fetch failed: ${clip(shorten(result.error), 140)}`);
		if (result.notices?.length) warn(`${title(step)}'s parser raised ${plural(result.notices.length, 'notice')}, often the first sign of a changed feed: ${clip(shorten(result.notices[0]), 140)}`);
		for (const text of result.warning ?? []) warn(`${title(step)}: ${clip(shorten(text), 140)}`);
	}
	if (pull.stderr && !pull.failure) say(`PHP printed: ${clip(shorten(pull.stderr), 300)}`);
}

// --- Report: today's games across the books -----------------------------------------------------

section(`Today's games${scheduleDay?.date ? `, ${scheduleDay.date}` : ''}`);
if (!scheduleFile) say('No schedule to read, so games can\'t be told apart.');
else if (!games.length) say('No games on the schedule, so there are no markets to check.');
else {
	if (scheduleDay?.date && scheduleDay.date !== etDay(pulledAt)) warn(`The schedule is for ${scheduleDay.date}, not the pull's day; the per-game checks are off`);
	say(`Game       Start  ${BOOKS.map((key) => key.padStart(5)).join('')}  (entries read for each game)`);
	// A book whose raw files couldn't be read can't say which game an entry is from
	const unreadable = (book) => !!book.readerError && book.entries.length > 0;
	for (const game of games) {
		const counts = BOOKS.map((key) => (unreadable(bookByKey[key]) ? '?' : String(bookByKey[key].byGame.get(game.id)?.length ?? 0)).padStart(5)).join('');
		say(`${game.label.padEnd(10)} ${etClock(game.start)}  ${counts}${game.started ? '  started before the pull' : ''}`);
	}
	for (const game of games) {
		if (game.started) continue;
		const covered = books.filter((book) => book.byGame.get(game.id)?.length);
		for (const book of books) {
			if (!pulled(book) || unreadable(book) || book.byGame.get(game.id)?.length) continue;
			const unread = book.families.filter((family) => family.anytime && family.games.get(game.id)?.priced);
			if (unread.length) fail(`${title(book.key)} prices ${quoteList(unread.map((family) => family.name))} for ${game.label}, and the parser read none of it`);
			else if (covered.length >= 2) warn(`${title(book.key)} has no scorer odds for ${game.label} while ${covered.length} books do; it may not have posted them yet`);
		}
	}
}

// --- Report: the market behind each book's entries ----------------------------------------------

section('Markets');
say('Each parsed entry is traced to the raw selection with its name and price. "Read" lists where entries came from, "Left" the other player scorer markets in the responses.');
for (const book of books) {
	say('');
	say(`### ${title(book.key)}: ${plural(book.entries.length, 'entry', 'entries')}`);
	if (!book.exists) {
		say(`No ${book.key}.json in the pull.`);
		continue;
	}
	if (!Array.isArray(book.raw)) {
		fail(`${title(book.key)}'s ${book.key}.json isn't a list, so the app can't load the page`);
		say(`${book.key}.json isn't a JSON list.`);
		continue;
	}
	if (book.invalid) fail(`${title(book.key)}: ${plural(book.invalid, 'entry', 'entries')} aren't a name and a numeric price, which the app rejects, failing the whole page`);
	if (book.readerError) {
		say(`The raw responses couldn't be read: ${book.readerError}`);
		if (book.entries.length) warn(`${title(book.key)}'s raw responses don't have the shape this check reads (${clip(book.readerError, 100)}); inspect them by hand`);
		continue;
	}
	const read = book.families.filter((family) => family.kept);
	const left = book.families.filter((family) => !family.kept);
	const gameNote = (family) => [...family.games.values()].filter((slot) => slot.kept || family.kept === 0)
		.map((slot) => (family.kept ? `${slot.label} ${slot.kept} of ${slot.priced}` : slot.label));
	for (const family of read) {
		const detail = family.details.size ? ` [${few([...family.details], 3)}]` : '';
		const verdict = family.anytime ? 'anytime' : `NOT anytime${family.problems.length ? `: ${family.problems.join(', ')}` : ''}`;
		say(`Read: "${family.name}"${detail}, ${verdict}; ${few(gameNote(family), 6)}`);
		if (!family.anytime) fail(`${title(book.key)} reads "${family.name}", which doesn't look like the anytime goal scorer market${family.problems.length ? ` (${family.problems.join(', ')})` : ''}`);
		for (const slot of family.games.values()) {
			if (slot.kept && slot.kept < slot.priced) warn(`${title(book.key)} read ${slot.kept} of the ${slot.priced} prices in "${family.name}" for ${slot.label}`);
		}
	}
	if (left.length) {
		say(`Left: ${few(left.map((family) => `"${family.name}"${family.anytime ? ' (anytime-like)' : ''} ${family.priced}`), 7)}`);
		for (const family of left.filter((candidate) => candidate.anytime)) {
			const slots = [...family.games.values()].filter((slot) => slot.game && !slot.game.started && book.byGame.get(slot.game.id)?.length);
			if (slots.length) warn(`${title(book.key)} also prices "${family.name}" for ${slots.map((slot) => slot.label).join(', ')}, which the parser left; check it isn't the market to read`);
		}
	}
	for (const [gameId, entries] of book.byGame) {
		const kinds = new Set(entries.map((entry) => entry.market.family));
		if (kinds.size > 1) warn(`${title(book.key)}'s entries for ${games.find((game) => game.id === gameId)?.label} came from ${kinds.size} markets: ${quoteList([...kinds])}`);
	}
	if (book.unattributed.length) {
		fail(`${title(book.key)}: ${plural(book.unattributed.length, 'entry', 'entries')} match no selection in the raw responses, so the parser reads something this check can't see: ${few(book.unattributed.map((entry) => `${entry.name} ${price(entry.odds)}`), 4)}`);
	}
	if (book.ambiguous) say(`${plural(book.ambiguous, 'entry', 'entries')} matched selections in more than one market, at the same price`);
	const duplicates = [...Map.groupBy(book.entries, (entry) => appFold(entry.name))].filter(([, list]) => list.length > 1);
	if (duplicates.length) warn(`${title(book.key)} lists ${plural(duplicates.length, 'name')} more than once, and the app keeps only the last: ${few(duplicates.map(([, list]) => `${list[0].name} ${list.map((entry) => price(entry.odds)).join('/')}`), 4)}`);
	if (book.offSchedule) {
		const note = `${plural(book.offSchedule, 'entry', 'entries')} came from games not on today's schedule`;
		say(book.key === 'bet1' ? `${note}; bet1 takes no end-of-day cutoff, so that's expected` : note);
		if (book.key !== 'bet1' && games.length) warn(`${title(book.key)}: ${note}, past its end-of-day cutoff`);
	}
	for (const note of book.notes) say(`Note: ${note}`);
	if (book.extra) warn(`${title(book.key)}: ${plural(book.extra, 'player')} carry more than one offer or outcome, and the parser reads only the first`);
	say(`Raw: ${few([...new Set(book.markets.flatMap((market) => market.files))].sort(), 6)}`);
}

// --- Report: prices -----------------------------------------------------------------------------

section('Prices');
const byPlayer = new Map();
for (const book of books) {
	for (const entry of book.entries) {
		const key = canonical(entry.name);
		const prices = byPlayer.get(key) ?? { name: reverseMap.get(entry.name) ?? entry.name, odds: {} };
		prices.odds[book.key] = entry.odds;
		byPlayer.set(key, prices);
	}
}
say('Book   Entries  Lowest  Median  Highest  Against the other books');
for (const book of books) {
	const odds = book.entries.map((entry) => entry.odds);
	if (!odds.length) {
		say(`${book.key.padEnd(6)} ${'0'.padStart(7)}`);
		continue;
	}
	const ratios = [];
	for (const prices of byPlayer.values()) {
		const mine = prices.odds[book.key];
		const others = BOOKS.filter((key) => key !== book.key && prices.odds[key] !== undefined).map((key) => prices.odds[key]);
		if (mine === undefined || others.length < 2) continue;
		ratios.push(mine / median(others));
	}
	const bias = median(ratios);
	const wide = ratios.filter((ratio) => beyond(ratio, SPREAD)).length;
	const against = bias === null ? 'too few shared players' : `${times(bias)} median, ${wide} beyond ${times(SPREAD)}`;
	say(`${book.key.padEnd(6)} ${String(odds.length).padStart(7)} ${price(Math.min(...odds)).padStart(7)} ${price(median(odds)).padStart(7)} ${price(Math.max(...odds)).padStart(8)}  ${against}`);
	const odd = odds.filter((value) => !(value > 1.01 && value < 1001));
	if (odd.length) fail(`${title(book.key)} has ${plural(odd.length, 'price')} that aren't decimal odds (${few(odd.slice(0, 4).map(String), 4)}); the app reads every price as decimal`);
	else if (median(odds) < 2 || median(odds) > 15) warn(`${title(book.key)}'s median price is ${price(median(odds))}, unusual for an anytime market`);
	if (bias !== null && beyond(bias, BOOK_BIAS)) fail(`${title(book.key)}'s prices run ${times(bias)} the other books' for the same players, so it's likely reading another market`);
}
const spreads = [...byPlayer.values()]
	.map((prices) => ({ ...prices, values: BOOKS.map((key) => prices.odds[key]).filter((value) => value !== undefined) }))
	.filter((prices) => prices.values.length >= 3)
	.map((prices) => ({ ...prices, ratio: Math.max(...prices.values) / Math.min(...prices.values) }))
	.filter((prices) => prices.ratio >= SPREAD)
	.sort((a, b) => b.ratio - a.ratio);
if (spreads.length) {
	say(`Widest spreads, as ${BOOKS.join(' / ')}:`);
	for (const prices of spreads.slice(0, SHOW)) say(`    ${prices.name}: ${BOOKS.map((key) => price(prices.odds[key])).join(' / ')} (${times(prices.ratio)})`);
	if (spreads.length > SHOW) say(`    and ${spreads.length - SHOW} more`);
} else say(`No player's prices are ${times(SPREAD)} apart across the books.`);

// --- Report: the live files, and the live copy of the parser ------------------------------------

section('Live files against this pull');
if (!liveDir) say('No live folder to compare.');
else {
	say('Book   Live  Written            Shared  Live against the pull');
	for (const book of books) {
		const path = join(liveDir, 'data', `${book.key}.json`);
		const stat = statOf(path);
		const items = validItems(readJson(path));
		if (!stat) {
			say(`${book.key.padEnd(6)} missing`);
			warn(`The live folder has no ${book.key}.json`);
			continue;
		}
		const livePrices = new Map(items.map((item) => [canonical(item.name), item.odds]));
		const ours = new Map(book.entries.map((entry) => [canonical(entry.name), entry.odds]));
		const shared = [...ours.keys()].filter((key) => livePrices.has(key));
		const ratios = shared.map((key) => livePrices.get(key) / ours.get(key));
		const moved = ratios.filter((ratio) => beyond(ratio, MOVED)).length;
		const written = `${etClock(stat.mtime)} (${span(now - stat.mtime)} ago)`;
		const compare = ratios.length ? `${times(median(ratios))} median, ${moved} moved over ${Math.round((MOVED - 1) * 100)}%` : '-';
		say(`${book.key.padEnd(6)} ${String(items.length).padStart(4)}  ${written.padEnd(18)} ${String(shared.length).padStart(6)}  ${compare}`);
		const upcoming = games.some((game) => !game.started);
		if (!items.length && book.entries.length && upcoming) warn(`The live ${book.key}.json is empty while ${title(book.key)} lists ${book.entries.length} players; the next cron run should fill it`);
		else if (items.length >= 10 && book.entries.length >= 10 && shared.length < Math.min(items.length, book.entries.length) / 2) {
			warn(`The live ${book.key}.json shares only ${shared.length} names with the pull`);
		}
		if (ratios.length >= 10 && beyond(median(ratios), 1.15)) warn(`The live ${book.key}.json prices run ${times(median(ratios))} the pull's`);
	}
}
if (livePull) {
	say('');
	say('The live copy of fetch_lib.php, pulled on its own:');
	for (const book of books) {
		const step = livePull.steps?.[book.key];
		const liveEntries = validItems(readJson(join(outDir, 'live-lib', `${book.key}.json`)));
		const outcome = step?.thrown ? `threw ${step.thrown}` : step?.error ? `error: ${step.error}` : `${plural(liveEntries.length, 'entry', 'entries')}`;
		const mine = new Set(book.entries.map((entry) => appFold(entry.name)));
		const theirs = new Set(liveEntries.map((entry) => appFold(entry.name)));
		const onlyMine = [...mine].filter((name) => !theirs.has(name)).length;
		const onlyTheirs = [...theirs].filter((name) => !mine.has(name)).length;
		say(`${title(book.key)}: ${shorten(outcome)}${onlyMine || onlyTheirs ? `; ${onlyMine} names only in this checkout's, ${onlyTheirs} only in the live copy's` : ', the same names'}`);
		if (step?.thrown) fail(`The live fetch_lib.php throws on ${title(book.key)}, which stops the cron's runs: ${clip(shorten(step.thrown), 140)}`);
		else if (!step?.error && pulled(book) && (onlyMine || onlyTheirs)) warn(`The live fetch_lib.php reads ${title(book.key)} differently from this checkout's: ${onlyMine} names only here, ${onlyTheirs} only there`);
	}
}

// --- Names: who each player is, and who they might be in a book ---------------------------------

const playersDir = join(dataRoot, 'players');
const playerCache = new Map();
const playerJson = (id) => {
	if (!playerCache.has(id)) playerCache.set(id, readJson(join(playersDir, `${id}.json`)));
	return playerCache.get(id);
};
// The default name first, then the language spellings nameFind tries
const rosterNames = (json) => {
	const first = json?.firstName ?? {};
	const last = json?.lastName ?? {};
	if (!first.default || !last.default) return [];
	const names = [`${first.default} ${last.default}`];
	for (const lang of Object.keys(first)) if (lang !== 'default') names.push(`${first[lang]} ${last[lang] ?? last.default}`);
	for (const lang of Object.keys(last)) if (lang !== 'default' && !(lang in first)) names.push(`${first.default} ${last[lang]}`);
	return [...new Set(names)];
};
// Every name a known player goes by, to tell a namesake from another spelling
const knownNames = new Map();
const know = (name, id) => {
	const key = looseFold(name);
	if (!knownNames.has(key)) knownNames.set(key, new Set());
	knownNames.get(key).add(id);
};
for (const file of listDir(playersDir)) {
	const id = Number(/^(\d+)\.json$/.exec(file)?.[1]);
	if (id) for (const name of rosterNames(playerJson(id))) know(name, id);
}
if (app) {
	for (const [roster, odds] of app.processor.oddsNameMap) for (const id of knownNames.get(looseFold(roster)) ?? []) know(odds, id);
}

// Why a book's name could be this player's, or null. Players share surnames (brothers, namesakes), so
// this is a lead to confirm, never a match
const relation = (ours, theirs) => {
	const a = looseFold(ours);
	const b = looseFold(theirs);
	if (!a || !b) return null;
	if (a === b) return 'the same name apart from punctuation or a suffix';
	const tokensA = a.split(' ');
	const tokensB = b.split(' ');
	if (tokensA.length === tokensB.length && [...tokensA].sort().join(' ') === [...tokensB].sort().join(' ')) return 'the same name in another order';
	const [lastA, lastB] = [tokensA.at(-1), tokensB.at(-1)];
	const [firstA, firstB] = [tokensA.slice(0, -1).join(' '), tokensB.slice(0, -1).join(' ')];
	if (firstA && firstB && lastA === lastB && (firstA[0] === firstB[0] || distance(firstA, firstB) <= 2)) return 'the same surname and a first name like it';
	if (firstA && firstA === firstB && lastA.length >= 4 && distance(lastA, lastB) <= 2) return 'the same first name and a surname like it';
	return null;
};
const candidatesFor = (id, ourNames, items) => {
	const own = new Set(ourNames.map(looseFold));
	const found = [];
	for (const item of items) {
		const key = looseFold(item.name);
		// A name another known player goes by is that player, unless this one goes by it too
		if ([...(knownNames.get(key) ?? [])].some((other) => other !== id) && !own.has(key)) continue;
		const reason = ourNames.map((name) => relation(name, item.name)).find(Boolean);
		if (reason && !found.some((candidate) => candidate.name === item.name)) found.push({ name: item.name, reason });
	}
	return found;
};

const listed = (helper) => LISTS.flatMap((list) => (Array.isArray(helper?.[list]) ? helper[list] : []).map((item) => ({
	id: item.playerId, list, team: item.team, helperName: `${item.firstName} ${item.lastName}`, json: playerJson(item.playerId),
})));
const teamStub = (code) => ({ code, name: String(code ?? 'team'), logoLight: '', logoDark: '' });
// The live app's matcher, compilePlayerList itself: the roster name, the map, then the language spellings
const appMatch = (players, files) => {
	const built = players.filter((player) => player.json?.firstName?.default && player.json?.lastName?.default).map((player) => ({
		player,
		made: new app.Player(player.json, teamStub(player.json.currentTeamAbbrev), teamStub('---'), true, new Date(0)),
	}));
	app.processor.compilePlayerList(built.map(({ made }) => made), ...BOOKS.map((key) => files[key] ?? []));
	return built.map(({ player, made }) => ({
		...player, roster: made.fullName, found: Object.fromEntries(BOOKS.map((key, index) => [key, made[`betRaw${index + 1}`] !== null])),
	}));
};
// The archive replays' matcher: the pick-list name, then the map read both ways (oddsNameCandidates)
const archiveMatch = (players, files) => {
	const sets = Object.fromEntries(BOOKS.map((key) => [key, new Set((files[key] ?? []).map((item) => appFold(item.name)))]));
	return new Map(players.map((player) => {
		const names = app.processor.oddsNameCandidates(player.helperName);
		return [player.id, Object.fromEntries(BOOKS.map((key) => [key, names.some((name) => sets[key].has(appFold(name)))]))];
	}));
};
// Two players with this name are told apart by id in compilePlayerList, which the archive lookup can't
const SPECIAL_CASED = new Set(['elias pettersson']);
// The names to compare a book's against, the one the matcher starts from first, so the reason given is about it
const ourNamesOf = (player, roster, archive = false) => [...new Set((archive ? [player.helperName, roster] : [roster, player.helperName])
	.concat(rosterNames(player.json)).filter(Boolean))];

// The entry each matcher would need: the app's looks up the roster name in the map, the archive's the
// pick-list name in the map read both ways
const suggestions = new Map();
const suggest = (key, value, book, reason, where) => {
	const id = `${key}\n${value}`;
	const suggestion = suggestions.get(id) ?? { key, value, books: new Set(), reasons: new Set(), where: new Set() };
	suggestion.books.add(book);
	suggestion.reasons.add(reason);
	suggestion.where.add(where);
	suggestions.set(id, suggestion);
};
const archiveFix = (helper, roster, value) => {
	if (helper === roster) return [roster, value];
	if (appFold(value) === appFold(roster)) return [roster, helper];
	return [helper, value];
};

// --- Report: names on today's lists -------------------------------------------------------------

const helperPath = join(dataRoot, 'data', 'helper.json');
const helperToday = readJson(helperPath);
await guard('today\'s names', () => {
	section('Names, today\'s lists');
	if (!app) return say('Skipped: the app\'s code didn\'t load.');
	if (!helperToday) return say(`Skipped: no ${shortPath(helperPath)}.`);
	if (!games.length) return say('Skipped: no games on today\'s schedule.');
	const players = listed(helperToday).map((player) => ({ ...player, game: gameByTeam.get(player.json?.currentTeamAbbrev ?? player.team) ?? gameByTeam.get(player.team) ?? null }));
	const playing = players.filter((player) => player.game);
	const missingFiles = playing.filter((player) => !player.json);
	const files = Object.fromEntries(BOOKS.map((key) => [key, bookByKey[key].entries]));
	const results = appMatch(playing, files);
	const archive = archiveMatch(playing, files);
	const drawn = typeof helperToday.dateTimeAvailable === 'string' ? `, drawn ${helperToday.dateTimeAvailable.replace('T', ' ').slice(0, 16)}` : '';
	say(`${plural(playing.length, 'player')} listed for today's games, from ${liveDir ? 'the live' : 'the checkout\'s'} helper.json${drawn}; prices from this pull`);
	if (missingFiles.length) {
		warn(`${plural(missingFiles.length, 'listed player')} have no player file, which stops the page from loading: ${few(missingFiles.map((player) => player.helperName), 4)}`);
	}
	const misses = [];
	const noGame = new Map();
	const counts = Object.fromEntries(BOOKS.map((key) => [key, { found: 0, of: 0 }]));
	for (const result of results) {
		for (const key of BOOKS) {
			const book = bookByKey[key];
			if (!book.entries.length) continue;
			// The book's entries for the player's game; all of them when the raw files couldn't be read
			const gameEntries = book.readerError ? book.entries : book.byGame.get(result.game.id) ?? [];
			if (!gameEntries.length) {
				push(noGame, key, result.game.label);
				continue;
			}
			counts[key].of += 1;
			if (result.found[key]) {
				counts[key].found += 1;
				if (!archive.get(result.id)?.[key] && !SPECIAL_CASED.has(appFold(result.helperName))) {
					const candidates = candidatesFor(result.id, ourNamesOf(result, result.roster, true), gameEntries);
					misses.push({ result, key, candidates, archiveOnly: true });
				}
				continue;
			}
			misses.push({ result, key, candidates: candidatesFor(result.id, ourNamesOf(result, result.roster), gameEntries), archiveOnly: false });
		}
	}
	say(`Found by the app's matcher, where the book prices the player's game: ${BOOKS.map((key) => `${key} ${counts[key].found} of ${counts[key].of}`).join(', ')}`);
	for (const [key, labels] of noGame) say(`No ${key} prices for: ${few([...new Set(labels)], 6)}`);
	const grouped = Map.groupBy(misses, (miss) => `${miss.archiveOnly}\n${miss.result.id}`);
	if (!grouped.size) say('Every listed player found the prices each book has for his game.');
	for (const group of grouped.values()) {
		const { result, archiveOnly } = group[0];
		const who = `${result.roster} (${result.json?.currentTeamAbbrev ?? result.team}, list ${result.list}${result.helperName !== result.roster ? `; the pick list says "${result.helperName}"` : ''})`;
		const byName = Map.groupBy(group, (miss) => miss.candidates.map((candidate) => candidate.name).join(' | '));
		for (const [names, list] of byName) {
			const keys = list.map((miss) => miss.key).join(' ');
			const lead = names ? `the book writes ${quoteList(names.split(' | '))} (${list[0].candidates[0].reason})` : 'no similar name among the book\'s prices for his game';
			say(`- ${who}: ${archiveOnly ? 'the archive replays\' matcher misses him in ' : ''}${keys}, ${lead}`);
			for (const miss of list) {
				for (const candidate of miss.candidates) {
					if (archiveOnly) {
						const [key, value] = archiveFix(result.helperName, result.roster, candidate.name);
						suggest(key, value, miss.key, candidate.reason, 'the archive matcher, today\'s lists');
					} else suggest(result.roster, candidate.name, miss.key, candidate.reason, 'the app\'s matcher, today\'s lists');
				}
			}
			if (!archiveOnly && names) warn(`${result.roster} finds no ${keys} price; ${quoteList(names.split(' | '))} may be him`);
			if (!archiveOnly && !names && list.length >= 2) warn(`${result.roster} finds no price in ${keys}, and nothing there looks like his name; search their raw files for his surname`);
		}
	}
});

// --- Report: names across the season's snapshots ------------------------------------------------

await guard('snapshot names', () => {
	const dataDir = join(dataRoot, 'data');
	const dayDirs = listDir(dataDir).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && isDir(join(dataDir, name))).sort();
	let windowDays = dayDirs;
	let windowNote = 'every snapshot day';
	if (options.days) {
		const from = shiftDay(today, -(options.days - 1));
		windowDays = dayDirs.filter((day) => day >= from);
		windowNote = `the last ${plural(options.days, 'day')}`;
	} else if (!options.all) {
		let start = dayDirs.length - 1;
		while (start > 0 && (utcDay(dayDirs[start]) - utcDay(dayDirs[start - 1])) / 86400000 <= SEASON_BREAK) start -= 1;
		windowDays = dayDirs.slice(Math.max(start, 0));
		windowNote = 'this season';
	}
	const slots = windowDays.flatMap((day) => listDir(join(dataDir, day)).filter((name) => /^\d{4}$/.test(name)).sort().map((time) => ({ day, time, dir: join(dataDir, day, time) })));
	section(`Names, snapshots${windowDays.length ? ` ${windowDays[0]} to ${windowDays.at(-1)}` : ''}, ${windowNote}`);
	if (!app) return say('Skipped: the app\'s code didn\'t load.');
	if (!slots.length) return say(`No snapshot folders in ${dataDir}.`);

	const differs = new Map();
	const unlisted = new Map();
	const checked = new Map();
	let noHelper = 0;
	const noFile = new Set();
	const record = (store, id, fields, slot, candidates) => {
		const entry = store.get(id) ?? { ...fields, slots: [], candidates: new Map() };
		entry.slots.push(`${slot.day} ${slot.time}`);
		for (const candidate of candidates) {
			const seen = entry.candidates.get(candidate.name) ?? { count: 0, reason: candidate.reason };
			seen.count += 1;
			entry.candidates.set(candidate.name, seen);
		}
		store.set(id, entry);
	};
	for (const slot of slots) {
		const helper = readJson(join(slot.dir, 'helper.json'));
		if (!helper) {
			noHelper += 1;
			continue;
		}
		const files = Object.fromEntries(BOOKS.map((key) => [key, validItems(readJson(join(slot.dir, `${key}.json`)))]));
		const players = listed(helper);
		for (const player of players) if (!player.json) noFile.add(player.helperName);
		const results = new Map(appMatch(players, files).map((result) => [result.id, result]));
		const archive = archiveMatch(players, files);
		for (const player of players) {
			// A player without a player file never reaches the app's matcher, but the archive replays still read him
			const result = results.get(player.id) ?? { ...player, roster: player.helperName, found: null };
			for (const key of BOOKS) {
				if (!files[key].length) continue;
				const id = `${result.id}\n${key}`;
				checked.set(id, (checked.get(id) ?? 0) + 1);
				const fields = { result, key };
				if (result.found && !result.found[key]) {
					const candidates = candidatesFor(result.id, ourNamesOf(result, result.roster), files[key]);
					if (candidates.length) record(differs, `app\n${id}`, { ...fields, kind: 'app' }, slot, candidates);
					// Missing from one book while others have him is worth a look even without a similar name
					else if (BOOKS.filter((other) => other !== key && result.found[other]).length >= 2) record(unlisted, id, fields, slot, []);
				} else if (!archive.get(result.id)?.[key] && !SPECIAL_CASED.has(appFold(result.helperName))) {
					const candidates = candidatesFor(result.id, ourNamesOf(result, result.roster, true), files[key]);
					// Where the app found a price the archive lookup is missing a spelling; without a player file
					// there's no telling that from a book that didn't list him, so it takes a similar name
					if (result.found || candidates.length) record(differs, `archive\n${id}`, { ...fields, kind: 'archive' }, slot, candidates);
				}
			}
		}
	}
	say(`${plural(slots.length, 'folder')} read${noHelper ? `, ${noHelper} without helper.json` : ''}${noFile.size ? `; no player file for ${few([...noFile], 4)}` : ''}`);
	const describe = (entry) => {
		const { result, key } = entry;
		const of = checked.get(`${result.id}\n${key}`) ?? entry.slots.length;
		const when = entry.slots.length > 1 ? `${entry.slots[0]} to ${entry.slots.at(-1)}` : entry.slots[0];
		return { team: result.json?.currentTeamAbbrev ?? result.team, count: `${entry.slots.length} of ${of} slots`, when };
	};
	const appMisses = [...differs.values()].filter((entry) => entry.kind === 'app');
	const archiveMisses = [...differs.values()].filter((entry) => entry.kind === 'archive');
	// One line per player and spelling, naming every book that writes it
	const grouped = (entries) => [...Map.groupBy(entries, (entry) => {
		const { count, when } = describe(entry);
		return [entry.result.id, [...entry.candidates.keys()].join('\n'), count, when].join('\n');
	}).values()].sort((a, b) => b[0].slots.length - a[0].slots.length || b.length - a.length);
	const spelled = (names) => names.map((name) => `"${name}"`).join(' or ');
	say('');
	say('The app\'s matcher, where a book had prices and a similar name:');
	if (!appMisses.length) say('    none');
	for (const group of grouped(appMisses)) {
		const entry = group[0];
		const { team, count, when } = describe(entry);
		const reason = [...entry.candidates.values()][0]?.reason ?? '';
		say(`- ${entry.result.roster} (${team}): ${group.map((item) => item.key).join(' ')} ${group.length > 1 ? 'write' : 'writes'} ${spelled([...entry.candidates.keys()])} in ${count}, ${when}; ${reason}`);
		for (const item of group) {
			for (const [name, seen] of item.candidates) suggest(item.result.roster, name, item.key, seen.reason, `the app's matcher, ${plural(item.slots.length, 'snapshot slot')}`);
		}
	}
	if (appMisses.length) warn(`${plural(new Set(appMisses.map((entry) => entry.result.id)).size, 'player')} missed a book's price in the snapshots where it lists a similar name (Names, snapshots)`);
	say('');
	say('The archive replays\' matcher (pick-list names), where the app\'s found him:');
	if (!archiveMisses.length) say('    none');
	for (const group of grouped(archiveMisses)) {
		const entry = group[0];
		const { team, count, when } = describe(entry);
		const names = [...entry.candidates.keys()];
		const roster = !entry.result.found ? '; no player file' : entry.result.helperName !== entry.result.roster ? `; roster "${entry.result.roster}"` : '';
		const books = group.map((item) => item.key).join(' ');
		const writes = names.length ? `; ${group.length > 1 ? 'they write' : 'it writes'} ${spelled(names)} (${entry.candidates.get(names[0]).reason})` : '';
		say(`- ${entry.result.helperName} (${team}${roster}): ${books} in ${count}, ${when}${writes}`);
		for (const item of group) {
			for (const [name, seen] of item.candidates) {
				const [key, value] = archiveFix(item.result.helperName, item.result.roster, name);
				suggest(key, value, item.key, seen.reason, `the archive matcher, ${plural(item.slots.length, 'snapshot slot')}`);
			}
		}
	}
	if (archiveMisses.length) warn(`${plural(new Set(archiveMisses.map((entry) => entry.result.id)).size, 'player')} lose a book in the archive replays (Names, snapshots)`);
	say('');
	say('Missing from one book while two or more others had him, with nothing like his name there:');
	const byBook = Map.groupBy([...unlisted.values()], (entry) => entry.key);
	if (!byBook.size) say('    none');
	for (const key of BOOKS) {
		const entries = (byBook.get(key) ?? []).sort((a, b) => b.slots.length - a.slots.length);
		if (entries.length) say(`- ${key}: ${few(entries.map((entry) => `${entry.result.roster} ${entry.slots.length}`), 10)}`);
	}
	say('Elias Pettersson is left out of the archive check: compilePlayerList tells the two apart by id, and the archive lookup can\'t.');
});

// --- Report: suggested map entries --------------------------------------------------------------

section('Suggested oddsNameMap entries');
if (!suggestions.size) say('None.');
else {
	say('Each is a lead. Confirm the book\'s name is this player before adding it (SKILL.md, step 3).');
	const map = app?.processor.oddsNameMap ?? new Map();
	const byKey = Map.groupBy([...suggestions.values()], (suggestion) => suggestion.key);
	for (const [key, list] of [...byKey].sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'base' }))) {
		for (const suggestion of list) {
			const comment = BOOKS.filter((book) => suggestion.books.has(book)).join(' ');
			say(`oddsNameMap.set(${JSON.stringify(suggestion.key)}, ${JSON.stringify(suggestion.value)}); // ${comment}`);
			say(`    seen: ${[...suggestion.where].join('; ')}; ${[...suggestion.reasons].join('; ')}`);
		}
		if (map.has(key)) say(`    "${key}" is already a key, mapped to "${map.get(key)}", and one key holds one spelling`);
		else if (list.length > 1) say(`    the books spell "${key}" ${list.length} ways, and one key holds one spelling`);
	}
}

// --- Print --------------------------------------------------------------------------------------

await viteServer?.close();
rmSync(cacheDir, { recursive: true, force: true });

const fails = attention.filter((item) => item.level === 'FAIL');
const verdict = fails.length ? 'Broken' : attention.length ? 'Needs attention' : 'OK';
const header = [`# Odds health, ${etStamp(now)} ET`, '', `Verdict: ${verdict}`];
if (attention.length) {
	header.push('', '## Attention');
	for (const item of [...fails, ...attention.filter((entry) => entry.level !== 'FAIL')]) header.push(`- ${item.level} ${item.text}`);
}
console.log([...header, ...out].join('\n'));
