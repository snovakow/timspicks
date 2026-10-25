#!/usr/bin/env node
// Archive analysis for the analyze skill. It rebuilds every archived pick window the way the app's archive
// replays build them (runSimulation and runHistoricalStrategyAudit in src/picksOptimizer.ts), proves the
// rebuild by fitting the correlation lifts from it and matching runSimulation's own, then tests three
// questions on actual results: whether picks from one game score together beyond their odds and whether the
// correlation lifts improve picks, whether one time slot gives better picks, and whether one book, or the
// average of any two, three or all four books, picks better. Each answer is then measured within the regular
// season and within the playoffs, and the two are compared.
//
//   node .claude/skills/analyze/scripts/analyze.mjs [--since YYYY-MM-DD] [--until YYYY-MM-DD]
//       [--format regular|playoff] [--root <site folder>]... [--live <dir>] [--seed N] [--boot N] [--out <dir>]
//
// It reads the archive and src/, and writes only into --out, plus a cache folder it removes. The repo is
// public, so nothing here names a host or a path on the server: the live folder is found at run time.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ET = 'America/New_York';
const LISTS = ['1', '2', '3'];
const BUCKETS = ['1', '2', '3', '4+'];

// This analysis's own settings
const ALPHA = 0.05; // two-sided, after Holm correction within each question
const SIGN_DRAWS = 50000; // random sign patterns, when a test has too many days to try every pattern
const EXACT_SIGNS = 16; // up to this many days, every sign pattern is tried
const SHOW = 5; // how many of the smallest p-values a long family lists
const CONTRAST_DAYS = 8; // days each format needs before its results are compared with the other format's

// --- Options ------------------------------------------------------------------------------------

const options = { since: null, until: null, format: null, roots: [], live: null, seed: 1, boot: 10000, out: null };
const ignored = [];
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
	const arg = args[index];
	const value = () => args[++index] ?? null;
	if (arg === '--since') options.since = value();
	else if (arg === '--until') options.until = value();
	else if (arg === '--format') options.format = value();
	else if (arg === '--root') options.roots.push(value());
	else if (arg === '--live') options.live = value();
	else if (arg === '--seed') options.seed = Math.floor(Number(value())) || 1;
	else if (arg === '--boot') {
		const draws = Math.floor(Number(value()));
		if (draws >= 1000) options.boot = draws;
	} else if (arg === '--out') options.out = value();
	else ignored.push(arg);
}
const isDay = (text) => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text);
const stop = (message) => {
	console.error(message);
	process.exit(2);
};
if (options.since !== null && !isDay(options.since)) stop('--since takes a date as YYYY-MM-DD');
if (options.until !== null && !isDay(options.until)) stop('--until takes a date as YYYY-MM-DD');
if (options.format !== null && !['regular', 'playoff'].includes(options.format)) stop('--format takes regular or playoff');

// --- Helpers ------------------------------------------------------------------------------------

const home = homedir();
const expand = (path) => (path ? resolve(path.replace(/^~(?=$|\/)/, home)) : null);
const tryRun = (command, commandArgs) => {
	const result = spawnSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 1 << 26 });
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
const clip = (text, max = 300) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const plural = (count, word, many = `${word}s`) => `${count.toLocaleString('en-US')} ${count === 1 ? word : many}`;
const total = (items, value = (item) => item) => items.reduce((sum, item) => sum + value(item), 0);
const average = (items, value = (item) => item) => (items.length ? total(items, value) / items.length : NaN);
const groupBy = (items, key) => {
	const map = new Map();
	for (const item of items) {
		const group = key(item);
		if (map.has(group)) map.get(group).push(item);
		else map.set(group, [item]);
	}
	return map;
};

// --- Statistics ---------------------------------------------------------------------------------

const mulberry32 = (seed) => () => {
	seed = (seed + 0x6D2B79F5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// Each test draws from its own stream, so adding a test never moves another test's numbers
const rngFor = (label) => {
	let hash = (2166136261 ^ options.seed) >>> 0;
	for (const char of label) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
	return mulberry32(hash);
};
const quantile = (sorted, q) => {
	if (!sorted.length) return NaN;
	const position = (sorted.length - 1) * q;
	const low = Math.floor(position);
	const high = Math.ceil(position);
	return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
};
// Windows on one day share players and results, so every resample draws whole days
const bootstrap = (label, days, statistic) => {
	const random = rngFor(label);
	const pick = new Array(days);
	const values = [];
	for (let draw = 0; draw < options.boot; draw += 1) {
		for (let index = 0; index < days; index += 1) pick[index] = Math.floor(random() * days);
		const value = statistic(pick);
		if (Number.isFinite(value)) values.push(value);
	}
	return values.sort((a, b) => a - b);
};
const interval = (sorted) => [quantile(sorted, 0.025), quantile(sorted, 0.975)];
// Two-sided percentile-bootstrap p for the statistic being `none`
const bootstrapP = (sorted, none) => {
	if (!sorted.length) return NaN;
	let below = 0;
	let above = 0;
	for (const value of sorted) {
		if (value <= none) below += 1;
		if (value >= none) above += 1;
	}
	return Math.min(1, (2 * Math.min(below, above) + 1) / (sorted.length + 1));
};
// Paired test: each day's summed difference keeps or flips its sign at random. With one pair per day and
// whole outcomes, this is the exact McNemar test
const signFlipP = (label, values) => {
	const nonzero = values.filter((value) => Math.abs(value) > 1e-12);
	if (!nonzero.length) return 1;
	const observed = Math.abs(total(nonzero)) * (1 - 1e-9);
	if (nonzero.length <= EXACT_SIGNS) {
		const patterns = 2 ** nonzero.length;
		let hits = 0;
		for (let mask = 0; mask < patterns; mask += 1) {
			let sum = 0;
			for (let index = 0; index < nonzero.length; index += 1) sum += (mask >> index) & 1 ? -nonzero[index] : nonzero[index];
			if (Math.abs(sum) >= observed) hits += 1;
		}
		return hits / patterns;
	}
	const random = rngFor(label);
	let hits = 0;
	for (let draw = 0; draw < SIGN_DRAWS; draw += 1) {
		let sum = 0;
		for (const value of nonzero) sum += random() < 0.5 ? -value : value;
		if (Math.abs(sum) >= observed) hits += 1;
	}
	return (hits + 1) / (SIGN_DRAWS + 1);
};
// A paired difference from per-day sums: the mean per window, a by-day interval, and the sign-flip p
const pairedTest = (label, days) => {
	const windows = total(days, (day) => day.count);
	const draws = bootstrap(label, days.length, (pick) => {
		let sum = 0;
		let count = 0;
		for (const index of pick) {
			sum += days[index].sum;
			count += days[index].count;
		}
		return sum / count;
	});
	const [low, high] = interval(draws);
	return { estimate: total(days, (day) => day.sum) / windows, low, high, p: signFlipP(label, days.map((day) => day.sum)), days: days.length, windows };
};
// Whether any of k paired series differs, by the spread of the k means. Each day's deviations from its own mean
// over the k keep or flip their sign together, as the paired test flips a day's difference, so the series keep
// how they move together. Shuffling the labels within days wouldn't: series that overlap, as the subsets of the
// books do, put most of a day's spread in a few of them, and a shuffle that spreads it evenly finds differences
// that aren't there too often. With two series this is the paired test
const anyDifferenceP = (label, daySums) => {
	const k = daySums[0]?.length ?? 0;
	if (k < 2) return 1;
	const deviations = daySums
		.map((sums) => {
			const mid = total(sums) / k;
			return sums.map((value) => value - mid);
		})
		.filter((values) => values.some((value) => Math.abs(value) > 1e-12));
	if (!deviations.length) return 1;
	const means = new Float64Array(k);
	const spread = (sign) => {
		means.fill(0);
		deviations.forEach((values, day) => {
			const flip = sign(day);
			for (let index = 0; index < k; index += 1) means[index] += flip * values[index];
		});
		return total(means, (value) => value * value);
	};
	const observed = spread(() => 1) * (1 - 1e-9);
	if (deviations.length <= EXACT_SIGNS) {
		const patterns = 2 ** deviations.length;
		let hits = 0;
		for (let mask = 0; mask < patterns; mask += 1) if (spread((day) => ((mask >> day) & 1 ? -1 : 1)) >= observed) hits += 1;
		return hits / patterns;
	}
	const random = rngFor(label);
	const signs = new Float64Array(deviations.length);
	let hits = 0;
	for (let draw = 0; draw < SIGN_DRAWS; draw += 1) {
		for (let day = 0; day < signs.length; day += 1) signs[day] = random() < 0.5 ? -1 : 1;
		if (spread((day) => signs[day]) >= observed) hits += 1;
	}
	return (hits + 1) / (SIGN_DRAWS + 1);
};
const holm = (ps) => {
	const order = ps.map((p, index) => ({ p: Number.isFinite(p) ? p : 1, index })).sort((a, b) => a.p - b.p);
	const adjusted = new Array(ps.length);
	let running = 0;
	order.forEach(({ p, index }, rank) => {
		running = Math.max(running, Math.min(1, (ps.length - rank) * p));
		adjusted[index] = running;
	});
	return adjusted;
};
// --- Output -------------------------------------------------------------------------------------

const out = [];
const say = (text = '') => out.push(text);
const section = (title) => out.push('', `## ${title}`);
const sub = (title) => out.push('', `### ${title}`);
const table = (header, rows) => {
	const cells = [header, ...rows].map((row) => row.map((cell) => String(cell ?? '')));
	const widths = header.map((_, column) => Math.max(...cells.map((row) => row[column]?.length ?? 0)));
	for (const row of cells) say(row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ').trimEnd());
};
const pct = (value, digits = 1) => (Number.isFinite(value) ? `${(100 * value).toFixed(digits)}%` : '-');
const signed = (value, digits = 1, scale = 100, unit = 'pp') => (Number.isFinite(value) ? `${value >= 0 ? '+' : '-'}${Math.abs(scale * value).toFixed(digits)}${unit}` : '-');
const pts = (value) => (Number.isFinite(value) ? value.toFixed(2) : '-');
const times = (value) => (Number.isFinite(value) ? `×${value.toFixed(2)}` : '-');
const pText = (p) => (!Number.isFinite(p) ? '-' : p < 0.001 ? '<0.001' : p.toFixed(3));
const span = ([low, high], format) => `[${format(low)}, ${format(high)}]`;
const clockFormat = new Intl.DateTimeFormat('en-US', {
	timeZone: ET, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
const etStamp = (date) => {
	const parts = Object.fromEntries(clockFormat.formatToParts(date).map(({ type, value }) => [type, value]));
	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
};

// --- Locate: the checkout, and the site folders the archive lives in ----------------------------

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = tryRun('git', ['-C', scriptDir, 'rev-parse', '--show-toplevel']) ?? resolve(scriptDir, '..', '..', '..', '..');
process.chdir(repoRoot);
const insideRepo = (dir) => !relative(repoRoot, realOr(dir)).startsWith('..');
const shortPath = (path) => {
	if (path === repoRoot) return '.';
	if (path.startsWith(`${repoRoot}/`)) return relative(repoRoot, path);
	return path.startsWith(`${home}/`) ? `~/${relative(home, path)}` : path;
};

// The route health-server takes: the cron line names update.php's URL and its lib, the running web
// server's config maps that URL to the update folder, and the live folder is lib beside it
const findLive = () => {
	if (options.live) return { dir: expand(options.live), how: '--live' };
	const processes = (tryRun('ps', ['-axww', '-o', 'command']) ?? '').split('\n').map((line) => line.trim());
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
	const docRoots = [...new Set([...confText.matchAll(/^\s*DocumentRoot\s+"?([^"\n]+?)"?\s*$/gm)].map((match) => match[1]))];
	const valid = (dir, lib) => !insideRepo(dir) && isFile(join(dir, 'update.php')) && isFile(join(dir, '..', lib, 'fetch_lib.php'));
	for (const job of jobs) {
		for (const root of docRoots) {
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

const notes = [];
const live = options.roots.length ? null : findLive();
const liveDir = live && isDir(live.dir) ? live.dir : null;
if (!options.roots.length && !liveDir) notes.push('No live folder was found, so only public/ was read; pass --live <dir> if it exists');
const requested = options.roots.length ? options.roots.map(expand) : [liveDir, join(repoRoot, 'public')];
const notFolders = requested.filter((dir) => dir && !isDir(dir));
if (options.roots.length && notFolders.length) stop(`Not a folder: ${notFolders.join(', ')}`);
const roots = requested.filter((dir, index) => dir && isDir(dir) && requested.indexOf(dir) === index);
const rootName = (root) => (root === liveDir ? `the live folder (${shortPath(root)})` : shortPath(root));

// --- What the app's replays run with ------------------------------------------------------------

const appSource = readText(join(repoRoot, 'src', 'App.tsx')) ?? '';
const optimizerSource = readText(join(repoRoot, 'src', 'picksOptimizer.ts')) ?? '';
const setting = (pattern, source, fallback, what) => {
	const value = Number(pattern.exec(source)?.[1]);
	if (Number.isFinite(value)) return value;
	notes.push(`Couldn't read ${what} from src/, so ${fallback} was used`);
	return fallback;
};
// App.tsx's starting Books setting, which its lift fitting runs with
const minSportsbooks = setting(/\[\s*minSportsbooks\s*,\s*setMinSportsbooks\s*\]\s*=\s*useState\(\s*(\d+)\s*\)/, appSource, 3, 'the default number of books');
const cutoffs = [...optimizerSource.matchAll(/oldestDate\s*=\s*new Date\(\s*["'](\d{4}-\d{2}-\d{2})["']\s*\)/g)].map((match) => match[1]);
const oldestDay = cutoffs.at(-1) ?? null;
if (!cutoffs.length) notes.push("Couldn't read the archive's earliest date from src/picksOptimizer.ts, so every archived day was read");
else if (new Set(cutoffs).size > 1) notes.push(`src/picksOptimizer.ts holds different earliest dates (${[...new Set(cutoffs)].join(', ')}); the lift fitting's, ${oldestDay}, was used`);

// --- The archive: history days from every site folder, snapshots from the first that has them ----

const dayOfFile = (file) => {
	const parts = String(file).split('_');
	return parts.length === 3 && isDay(parts[1]) ? parts[1] : null;
};
const historyPath = new Map();
const ranges = new Map();
for (const root of roots) {
	const index = readJson(join(root, 'history', 'history.json'));
	if (!Array.isArray(index)) continue;
	for (const item of index) {
		const key = `${item.season}|${item.format}`;
		if (!ranges.has(key)) ranges.set(key, { season: item.season, format: item.format, files: new Set() });
		for (const file of item.files ?? []) {
			const path = join(root, 'history', file);
			if (!dayOfFile(file) || !isFile(path)) continue;
			if (!historyPath.has(file)) historyPath.set(file, path);
			ranges.get(key).files.add(file);
		}
	}
}
const keepDay = (day) => (!oldestDay || day >= oldestDay) && (!options.since || day >= options.since) && (!options.until || day <= options.until);
// The index both replays are served: each range with the days any folder holds, oldest first
const manifest = [...ranges.values()]
	.filter((range) => !options.format || range.format === options.format)
	.map((range) => {
		const files = [...range.files].filter((file) => keepDay(dayOfFile(file))).sort((a, b) => dayOfFile(a).localeCompare(dayOfFile(b)));
		return { season: range.season, format: range.format, start: dayOfFile(files[0] ?? ''), end: dayOfFile(files.at(-1) ?? ''), files };
	})
	.filter((range) => range.files.length)
	.sort((a, b) => a.start.localeCompare(b.start));
if (!manifest.length) stop(`No archived days to analyze in ${roots.map(shortPath).join(' or ') || 'any site folder'} with these options`);

// A day's schedule comes from the first folder that has it, and so do its snapshots, unless only a later folder has one
const dayRoots = new Map();
const dayRoot = (day) => {
	if (!dayRoots.has(day)) dayRoots.set(day, roots.find((root) => isFile(join(root, 'data', day, 'games.json'))) ?? null);
	return dayRoots.get(day);
};
const slotRoots = new Map();
const slotRoot = (day, slot) => {
	const key = `${day}/${slot}`;
	if (!slotRoots.has(key)) {
		const first = dayRoot(day);
		const order = first ? [first, ...roots.filter((root) => root !== first)] : roots;
		slotRoots.set(key, order.find((root) => isFile(join(root, 'data', day, slot, 'helper.json'))) ?? null);
	}
	return slotRoots.get(key);
};
const archivePath = (src) => {
	const rel = String(src).replace(/^\.\//, '').replace(/[?#].*$/, '');
	if (rel === 'history/history.json') return 'manifest';
	let match = /^history\/([^/]+)$/.exec(rel);
	if (match) return historyPath.get(match[1]) ?? null;
	match = /^data\/(\d{4}-\d{2}-\d{2})\/([^/]+\.json)$/.exec(rel);
	if (match) {
		const root = dayRoot(match[1]);
		return root ? join(root, 'data', match[1], match[2]) : null;
	}
	match = /^data\/(\d{4}-\d{2}-\d{2})\/(\d{4})\/([^/]+\.json)$/.exec(rel);
	if (match) {
		const root = slotRoot(match[1], match[2]);
		return root ? join(root, 'data', match[1], match[2], match[3]) : null;
	}
	return null;
};
const texts = new Map();
const archiveJson = (src) => {
	const path = archivePath(src);
	if (path === 'manifest') return JSON.parse(JSON.stringify(manifest));
	if (!path) return null;
	if (!texts.has(path)) texts.set(path, readText(path));
	return parseJson(texts.get(path));
};
// The app's replays fetch relative URLs; serve them from the archive above
globalThis.fetch = async (src) => {
	const data = archiveJson(src);
	if (data === null) return { ok: false, status: 404, statusText: 'Not Found', json: async () => { throw new Error('Not Found'); } };
	return { ok: true, status: 200, statusText: 'OK', json: async () => data };
};

// --- The app's own code, loaded from src/ the way the browser runs it ---------------------------

const cacheDir = mkdtempSync(join(tmpdir(), 'analyze-cache-'));
let viteServer = null;
const cleanup = async () => {
	try { await viteServer?.close(); } catch { /* closing is best effort */ }
	rmSync(cacheDir, { recursive: true, force: true });
};
let app = null;
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
	const load = (path) => viteServer.ssrLoadModule(path);
	const optimizer = await load('/src/picksOptimizer.ts');
	const selection = await load('/src/strategySelection.ts');
	const processor = await load('/src/dataProcessor.ts');
	const types = await load('/src/dataTypes.ts');
	const features = await load('/src/features.ts');
	const shipped = await load('/src/correlationData.ts');
	app = {
		calcAny: optimizer.calcAny, calcPnt: optimizer.calcPnt, calcHit: optimizer.calcHit,
		correlatedValue: optimizer.correlatedValue, pairLift: optimizer.pairLift, runSimulation: optimizer.runSimulation,
		ComboGroup: selection.ComboGroup,
		oddsNameCandidates: processor.oddsNameCandidates, removeAccentsNormalize: processor.removeAccentsNormalize, deVig: processor.deVig,
		SportsbookKeys: types.SportsbookKeys, LogStatsKeys: types.LogStatsKeys,
		StrategyLabels: types.StrategyLabels, Sportsbooks: types.Sportsbooks,
		normalizeSportsbooks: features.normalizeSportsbooks, shippedLifts: shipped.pairLifts,
	};
	const missing = Object.entries(app).filter(([name, value]) => value === undefined && name !== 'normalizeSportsbooks').map(([name]) => name);
	if (missing.length) throw new Error(`src/ no longer exports ${missing.join(', ')}`);
} catch (error) {
	console.error(`The app's code didn't load from src/, so nothing was analyzed: ${clip(String(error?.message ?? error))}`);
	await cleanup();
	process.exit(1);
}
const { calcAny, calcPnt, calcHit, ComboGroup, oddsNameCandidates, removeAccentsNormalize } = app;
const BOOKS = [...app.SportsbookKeys];
const KEYS = [...app.LogStatsKeys];
// Every subset of the books, smallest first: each book alone, each pair, each triple, and all four, which is the
// Avg. A subset prices a player at the average of its books that price him, as the Avg does with all four. The
// sportsbook tests compare all of them; the alternatives are the ones tested against the Avg
const SUBSETS = [...Array(2 ** BOOKS.length).keys()].slice(1)
	.map((mask) => BOOKS.filter((_, index) => (mask >> index) & 1))
	.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()))
	.map((books) => ({ key: books.length === BOOKS.length ? 'betAvg' : books.join('+'), books }));
const SUBSET_KEYS = SUBSETS.map((subset) => subset.key);
const ALTERNATIVES = SUBSET_KEYS.filter((key) => key !== 'betAvg');
// Correlation can't change the expected number of correct picks, so only these two are backtested
const CORRELATED = ['least1', 'points'];
// The challenge's points by number of correct picks, as calcPnt scores them
const POINTS = [0, calcPnt(1, 0, 0), calcPnt(1, 1, 0), calcPnt(1, 1, 1)];
const keyName = (key) => (key === 'betAvg' ? 'Avg' : key);
const strategyName = (strategy) => app.StrategyLabels?.[strategy] ?? strategy;
const bucketOf = (games) => (games === 1 ? '1' : games === 2 ? '2' : games === 3 ? '3' : '4+');
const bucketName = (bucket) => `${bucket} ${bucket === '1' ? 'game' : 'games'}`;

// --- Rebuild every window, as runSimulation does ------------------------------------------------

class Row {
	constructor(fields) { Object.assign(this, fields); }
	sameTeam(other) { return this.team === other.team; }
	opponentTeam(other) { return this.team === other.opponent; }
	sameGame(other) { return this.sameTeam(other) || this.opponentTeam(other); }
}
const startTimes = (day) => {
	const schedule = archiveJson(`./data/${day}/games.json`);
	if (!schedule) return [];
	const groups = new Set();
	for (const week of schedule.gameWeek ?? []) {
		if (week.date !== day) continue;
		for (const game of week.games ?? []) {
			const formatter = new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: '2-digit', minute: '2-digit', hour12: false });
			const parts = Object.fromEntries(formatter.formatToParts(new Date(game.startTimeUTC)).map((part) => [part.type, part.value]));
			groups.add(`${parts.hour}${parts.minute}`);
		}
	}
	return [...groups].sort();
};
const coverage = { days: [], noWindows: [], missingFiles: [], noPlayers: [], emptyList: [], notInHistory: 0, borrowed: [] };
const countGames = (helper, playerSets) => {
	const teams = new Set();
	let games = 0;
	for (const sid of LISTS) {
		const outcomes = playerSets.get(sid);
		if (!outcomes) continue;
		for (const item of helper[sid] ?? []) {
			const player = outcomes.get(item.playerId);
			if (!player || teams.has(player.team)) continue;
			teams.add(player.team);
			teams.add(player.opponent);
			games += 1;
		}
	}
	return games;
};
// A ticket's result, averaged over the tickets tied with it
const outcome = (combos) => {
	let least1 = 0;
	let points = 0;
	let hits = 0;
	let count = 0;
	for (const combo of combos) {
		const hitCount = (combo.pick1.scored ? 1 : 0) + (combo.pick2.scored ? 1 : 0) + (combo.pick3.scored ? 1 : 0);
		if (hitCount > 0) least1 += 1;
		points += POINTS[hitCount];
		hits += hitCount;
		count += 1;
	}
	if (count > 1) {
		least1 /= count;
		points /= count;
		hits /= count;
		count = 1;
	}
	return { least1, points, hits, count };
};
const scoreOf = (group) => ({
	least1: calcAny(group.prob1, group.prob2, group.prob3),
	points: calcPnt(group.prob1, group.prob2, group.prob3),
	hits: calcHit(group.prob1, group.prob2, group.prob3),
});
const ticketOf = (combos) => combos.map((combo) => `${combo.pick1.id}:${combo.pick2.id}:${combo.pick3.id}`).sort().join('|');
const idsOf = (combos) => combos.map((combo) => [combo.pick1.id, combo.pick2.id, combo.pick3.id]);

const historyByDay = new Map();
const formatOf = new Map();
for (const range of manifest) {
	for (const file of range.files) {
		historyByDay.set(dayOfFile(file), file);
		formatOf.set(dayOfFile(file), range.format);
	}
}
const windows = [];
for (const [day, file] of historyByDay) {
	const history = archiveJson(`./history/${file}`);
	if (!Array.isArray(history?.playerLists)) {
		coverage.noWindows.push(`${day} (unreadable history)`);
		continue;
	}
	coverage.days.push(day);
	const playerSets = new Map();
	for (const list of history.playerLists) playerSets.set(String(list.id), new Map((list.players ?? []).map((player) => [Math.abs(player.nhlPlayerId), player])));
	const slots = startTimes(day);
	let kept = 0;
	for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
		const time = slots[slotIndex];
		const folder = `./data/${day}/${time}`;
		const helper = archiveJson(`${folder}/helper.json`);
		const bookOdds = BOOKS.map((book) => archiveJson(`${folder}/${book}.json`));
		if (!helper || bookOdds.some((items) => items === null)) {
			coverage.missingFiles.push(`${day} ${time}`);
			continue;
		}
		const oddsMaps = bookOdds.map((items) => {
			const map = new Map();
			for (const item of items ?? []) map.set(removeAccentsNormalize(item.name), item.odds);
			return map;
		});
		const rows = [];
		for (const sid of LISTS) {
			const outcomes = playerSets.get(sid);
			if (!outcomes) continue;
			for (const item of helper[sid] ?? []) {
				const player = outcomes.get(item.playerId);
				if (!player) {
					coverage.notInHistory += 1;
					continue;
				}
				const name = `${item.firstName} ${item.lastName}`;
				const candidates = oddsNameCandidates(name);
				const probs = [null, null, null, null];
				for (let index = 0; index < oddsMaps.length; index += 1) {
					for (const candidate of candidates) {
						const odds = oddsMaps[index].get(removeAccentsNormalize(candidate));
						if (odds !== undefined) {
							probs[index] = 1 / odds;
							break;
						}
					}
				}
				rows.push(new Row({
					sid, id: item.playerId, name, team: player.team, opponent: player.opponent, scored: player.scored,
					bet1: probs[0], bet2: probs[1], bet3: probs[2], bet4: probs[3], betAvg: null, betCount: 0,
				}));
			}
		}
		if (!rows.length) {
			coverage.noPlayers.push(`${day} ${time}`);
			continue;
		}
		if (app.normalizeSportsbooks) app.deVig(rows);
		for (const row of rows) {
			const values = BOOKS.map((book) => row[book]).filter((value) => value !== null);
			row.betCount = values.length;
			row.betAvg = values.length >= minSportsbooks ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
			for (const { key, books } of SUBSETS) {
				if (books.length === 1 || key === 'betAvg') continue;
				const prices = books.map((book) => row[book]).filter((value) => value !== null);
				row[key] = prices.length ? prices.reduce((sum, value) => sum + value, 0) / prices.length : null;
			}
		}
		const gameCount = countGames(helper, playerSets);
		if (gameCount === 0) {
			coverage.noPlayers.push(`${day} ${time}`);
			continue;
		}
		const sets = LISTS.map((sid) => rows.filter((row) => row.sid === sid && row.betAvg !== null && row.betCount >= minSportsbooks));
		if (sets.some((set) => !set.length)) {
			coverage.emptyList.push(`${day} ${time}`);
			continue;
		}
		if (slotRoot(day, time) !== dayRoot(day)) coverage.borrowed.push(`${day} ${time} from ${shortPath(slotRoot(day, time))}`);
		const window = { day, format: formatOf.get(day), time, slotIndex, gameCount, bucket: bucketOf(gameCount), rows, books: {} };
		for (const key of SUBSET_KEYS) {
			// The subset's lists: the players it prices, among those with an Avg
			const lists = sets.map((set) => set.filter((row) => row[key] !== null));
			const top = new ComboGroup();
			for (const pick1 of lists[0]) {
				for (const pick2 of lists[1]) {
					for (const pick3 of lists[2]) {
						top.add({ pick1, pick2, pick3, prob1: pick1[key], prob2: pick2[key], prob3: pick3[key] });
					}
				}
			}
			if (!top.combos.length) continue;
			window.books[key] = {
				top: { probs: [top.prob1, top.prob2, top.prob3], pred: scoreOf(top), real: outcome(top.combos), ticket: ticketOf(top.combos), combos: idsOf(top.combos) },
				lists,
			};
		}
		windows.push(window);
		kept += 1;
	}
	if (!kept) coverage.noWindows.push(day);
}
if (!windows.length) {
	console.error('No archived window could be rebuilt, so nothing was analyzed');
	await cleanup();
	process.exit(1);
}

// --- The app's own lift fitting over the same archive, to check the rebuild against -------------

let appLifts = null;
let appLiftsError = null;
{
	const saved = [console.log, console.info, console.warn, console.error];
	console.log = console.info = console.warn = console.error = () => {};
	try {
		appLifts = await app.runSimulation(minSportsbooks);
	} catch (error) {
		appLiftsError = clip(String(error?.message ?? error), 200);
	} finally {
		[console.log, console.info, console.warn, console.error] = saved;
	}
}

const days = [...new Set(windows.map((window) => window.day))];
const dayIndex = new Map(days.map((day, index) => [day, index]));
const results = {};

// --- 1. Correlation -----------------------------------------------------------------------------

// One row per player per day: the first window listing him with enough books for an Avg, which is when most picks are made
const playerDays = [];
{
	const seen = new Set();
	for (const window of windows) {
		for (const row of window.rows) {
			if (row.betAvg === null || row.betCount < minSportsbooks) continue;
			const key = `${window.day}|${row.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			playerDays.push({ ...row, day: window.day, dayIndex: dayIndex.get(window.day), scored: !!row.scored });
		}
	}
}

// 1a. Pairs of listed players on the same day. Expected counts use the raw Avg prices, which carry the books'
// margin and drift from day to day; each day's teammate (or opponent) pairs are compared with that day's
// pairs from different games, which are independent by construction, so the margin cancels within the day
const PAIR_KINDS = ['same', 'opp', 'diff'];
const pairDays = days.map(() => Object.fromEntries(PAIR_KINDS.map((kind) => [kind, { pairs: 0, both: 0, expected: 0 }])));
for (const [index, players] of groupBy(playerDays, (row) => row.dayIndex)) {
	for (let a = 0; a < players.length; a += 1) {
		for (let b = a + 1; b < players.length; b += 1) {
			const x = players[a];
			const y = players[b];
			const kind = x.team === y.team ? 'same' : x.team === y.opponent ? 'opp' : 'diff';
			const cell = pairDays[index][kind];
			cell.pairs += 1;
			if (x.scored && y.scored) cell.both += 1;
			cell.expected += x.betAvg * y.betAvg;
		}
	}
}
const pooledLift = (pick, kind, cells = pairDays) => {
	let upper = 0;
	let lower = 0;
	for (const index of pick) {
		const cell = cells[index][kind];
		const control = cells[index].diff;
		const weight = cell.expected + control.expected;
		if (!(weight > 0)) continue;
		upper += (cell.both * control.expected) / weight;
		lower += (control.both * cell.expected) / weight;
	}
	return upper / lower;
};
const everyDay = days.map((_, index) => index);
const pairs = {};
for (const kind of PAIR_KINDS) {
	const cells = pairDays.map((day) => day[kind]);
	pairs[kind] = { pairs: total(cells, (cell) => cell.pairs), both: total(cells, (cell) => cell.both), expected: total(cells, (cell) => cell.expected) };
	if (kind === 'diff') continue;
	const draws = bootstrap(`pairs-${kind}`, days.length, (pick) => pooledLift(pick, kind));
	Object.assign(pairs[kind], { lift: pooledLift(everyDay, kind), interval: interval(draws), p: bootstrapP(draws, 1) });
}
results.pairs = pairs;

// The lifts as the app fits them. The rebuild check: runSimulation, reading the same archive, must give these
// exactly. And whether the lifts shipped in src/correlationData.ts were fitted on this archive
const sortedDays = [...days].sort();
const fitted = {
	teammates: pairs.same.lift, opponents: pairs.opp.lift,
	from: sortedDays[0] ?? '', through: sortedDays.at(-1) ?? '', days: days.length, playerDays: playerDays.length,
};
const LIFT_FIELDS = Object.keys(fitted);
const liftsDiffer = (other) => LIFT_FIELDS.filter((field) => !Object.is(fitted[field], other?.[field]));
const liftField = (lifts, field) => {
	const value = lifts?.[field];
	return typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(6) : JSON.stringify(value ?? null);
};
const differText = (other, fields) => fields.map((field) => `${field} ${liftField(other, field)} vs ${liftField(fitted, field)}`).join(', ');
const rebuildDiffer = appLifts ? liftsDiffer(appLifts) : null;
const rebuildOk = !!rebuildDiffer && !rebuildDiffer.length;
const shippedDiffer = liftsDiffer(app.shippedLifts);
results.lifts = { fitted, app: appLifts, shipped: app.shippedLifts };

// The same lifts among the players near the top of their lists, whom the picks come from, against all other
// pairs. A player's strength is their Avg price over their list's top Avg price, the best over the day's
// windows. The app fits on every pair; a difference here would mean fitting on these instead. The cutoff
// was chosen, not calibrated
const NEAR_TOP = 0.75;
const strength = new Map();
for (const window of windows) {
	const priced = window.rows.filter((row) => row.betAvg !== null && row.betCount >= minSportsbooks);
	const tops = new Map(LISTS.map((sid) => [sid, Math.max(...priced.filter((row) => row.sid === sid).map((row) => row.betAvg))]));
	for (const row of priced) {
		const key = `${window.day}|${row.id}`;
		strength.set(key, Math.max(strength.get(key) ?? 0, row.betAvg / tops.get(row.sid)));
	}
}
const nearTop = (row) => strength.get(`${row.day}|${row.id}`) >= NEAR_TOP;
const tierDays = Object.fromEntries(['near', 'rest'].map((tier) => [tier, days.map(() => Object.fromEntries(PAIR_KINDS.map((kind) => [kind, { pairs: 0, both: 0, expected: 0 }])))]));
for (const [index, players] of groupBy(playerDays, (row) => row.dayIndex)) {
	for (let a = 0; a < players.length; a += 1) {
		for (let b = a + 1; b < players.length; b += 1) {
			const x = players[a];
			const y = players[b];
			const kind = x.team === y.team ? 'same' : x.team === y.opponent ? 'opp' : 'diff';
			const cell = tierDays[nearTop(x) && nearTop(y) ? 'near' : 'rest'][index][kind];
			cell.pairs += 1;
			if (x.scored && y.scored) cell.both += 1;
			cell.expected += x.betAvg * y.betAvg;
		}
	}
}
const nearTopTests = {};
for (const kind of ['same', 'opp']) {
	const near = tierDays.near;
	const rest = tierDays.rest;
	const nearDraws = bootstrap(`near-top-${kind}`, days.length, (pick) => pooledLift(pick, kind, near));
	const ratioDraws = bootstrap(`near-top-ratio-${kind}`, days.length, (pick) => pooledLift(pick, kind, near) / pooledLift(pick, kind, rest));
	nearTopTests[kind] = {
		pairs: total(near, (day) => day[kind].pairs), both: total(near, (day) => day[kind].both),
		near: pooledLift(everyDay, kind, near), nearInterval: interval(nearDraws), rest: pooledLift(everyDay, kind, rest),
		ratio: pooledLift(everyDay, kind, near) / pooledLift(everyDay, kind, rest), interval: interval(ratioDraws), p: bootstrapP(ratioDraws, 1),
	};
}
holm([nearTopTests.same.p, nearTopTests.opp.p]).forEach((adjusted, index) => { nearTopTests[index ? 'opp' : 'same'].adjusted = adjusted; });
results.nearTop = nearTopTests;

// 1b. Backtest: the app's highlighted pick for each book and strategy, with correlation off and on. On, every
// ticket is valued with the lifts by the app's own code, as its Stats view picks. "Held out" refits the lifts
// without the day being tested, so a day never votes for its own picks
const NO_LIFTS = { teammates: 1, opponents: 1 };
const choose = (book, key, strategy, lifts) => {
	const [list1, list2, list3] = book.lists;
	// Each pair's lift once, then every ticket, kept with its ties as the app keeps them
	const links = (a, b) => a.map((x) => b.map((y) => app.pairLift(x, y, 1, lifts)));
	const links12 = links(list1, list2);
	const links13 = links(list1, list3);
	const links23 = links(list2, list3);
	const group = new ComboGroup((candidate) => app.correlatedValue(
		strategy, candidate.prob1, candidate.prob2, candidate.prob3,
		links12[candidate.i][candidate.j], links13[candidate.i][candidate.k], links23[candidate.j][candidate.k],
	));
	list1.forEach((pick1, i) => list2.forEach((pick2, j) => list3.forEach((pick3, k) => {
		group.add({ pick1, pick2, pick3, prob1: pick1[key], prob2: pick2[key], prob3: pick3[key], i, j, k });
	})));
	return { ticket: ticketOf(group.combos), real: outcome(group.combos) };
};
const heldOutLifts = new Map(days.map((day, index) => {
	const others = everyDay.filter((other) => other !== index);
	return [day, { teammates: pooledLift(others, 'same'), opponents: pooledLift(others, 'opp') }];
}));
const backtest = {};
// Each backtest's per-day differences, held out minus off, for the format comparison
const backtestDays = new Map();
for (const key of KEYS) {
	backtest[key] = {};
	for (const strategy of CORRELATED) {
		const perDay = new Map();
		const sums = { off: 0, inSample: 0, heldOut: 0, windows: 0, changed: 0 };
		for (const window of windows) {
			const book = window.books[key];
			if (!book) continue;
			const off = choose(book, key, strategy, NO_LIFTS);
			const inSample = choose(book, key, strategy, fitted);
			const heldOut = choose(book, key, strategy, heldOutLifts.get(window.day));
			sums.windows += 1;
			sums.off += off.real[strategy];
			sums.inSample += inSample.real[strategy];
			sums.heldOut += heldOut.real[strategy];
			if (heldOut.ticket !== off.ticket) sums.changed += 1;
			const day = perDay.get(window.day) ?? { sum: 0, count: 0 };
			day.sum += heldOut.real[strategy] - off.real[strategy];
			day.count += 1;
			perDay.set(window.day, day);
		}
		if (!sums.windows) continue;
		backtestDays.set(`${key}|${strategy}`, perDay);
		backtest[key][strategy] = {
			windows: sums.windows, changed: sums.changed,
			off: sums.off / sums.windows, inSample: sums.inSample / sums.windows, heldOut: sums.heldOut / sums.windows,
			test: pairedTest(`backtest-${key}-${strategy}`, [...perDay.values()]),
		};
	}
}
results.backtest = backtest;

// --- 2. Time slot: the Avg top ticket in each window, by games left in the lists ----------------

const metric = (window, key = 'betAvg') => {
	const top = window.books[key].top;
	return {
		streak: top.real.least1, picks: top.real.hits / 3, points: top.real.points,
		oddsStreak: top.pred.least1, oddsPicks: top.pred.hits / 3, oddsPoints: top.pred.points,
	};
};
const avgWindows = windows.filter((window) => window.books.betAvg);
const avgByDay = groupBy(avgWindows, (window) => window.day);
// The first window of each slot per day, the one the app's audit reads for that slot
const firstOfBucket = new Map();
for (const [day, list] of avgByDay) {
	const firsts = new Map();
	for (const window of list) if (!firsts.has(window.bucket)) firsts.set(window.bucket, window);
	firstOfBucket.set(day, firsts);
}
const meanOf = (list, pick) => average(list, (window) => pick(metric(window)));
const dayMeanInterval = (label, list, pick) => {
	const values = list.map((window) => pick(metric(window)));
	return interval(bootstrap(label, values.length, (chosen) => average(chosen, (index) => values[index])));
};
const slotRows = BUCKETS.map((bucket) => {
	const list = [...firstOfBucket.values()].map((firsts) => firsts.get(bucket)).filter(Boolean);
	const byFormat = Object.fromEntries(['regular', 'playoff'].map((format) => {
		const part = list.filter((window) => window.format === format);
		return [format, { days: part.length, odds: meanOf(part, (m) => m.oddsStreak), actual: meanOf(part, (m) => m.streak) }];
	}));
	return {
		bucket, days: list.length,
		odds: meanOf(list, (m) => m.oddsStreak), actual: meanOf(list, (m) => m.streak), interval: list.length ? dayMeanInterval(`slot-${bucket}`, list, (m) => m.streak) : [NaN, NaN],
		picks: meanOf(list, (m) => m.picks), oddsPoints: meanOf(list, (m) => m.oddsPoints), points: meanOf(list, (m) => m.points), byFormat,
	};
});
const SLOT_PAIRS = [['4+', '3'], ['4+', '2'], ['4+', '1'], ['3', '2'], ['3', '1'], ['2', '1'], ['first', 'last']];
// The days that had both slots, with each slot's window that day
const matchSlots = (a, b) => {
	const matched = [];
	for (const [day, firsts] of firstOfBucket) {
		if (a === 'first') {
			const list = avgByDay.get(day);
			if (list.length >= 2) matched.push([list[0], list.at(-1)]);
		} else if (firsts.has(a) && firsts.has(b)) matched.push([firsts.get(a), firsts.get(b)]);
	}
	return matched;
};
const slotPairs = SLOT_PAIRS.map(([a, b]) => {
	const matched = matchSlots(a, b);
	const label = a === 'first' ? 'first vs last window' : `${a} vs ${bucketName(b)}`;
	const diffs = (pick) => matched.map(([x, y]) => ({ sum: pick(metric(x)) - pick(metric(y)), count: 1 }));
	return {
		a, b, label, days: matched.length,
		aBetter: matched.filter(([x, y]) => metric(x).streak > metric(y).streak + 1e-9).length,
		bBetter: matched.filter(([x, y]) => metric(y).streak > metric(x).streak + 1e-9).length,
		oddsDiff: average(matched, ([x, y]) => metric(x).oddsStreak - metric(y).oddsStreak),
		streak: matched.length ? pairedTest(`slot-streak-${label}`, diffs((m) => m.streak)) : null,
		picks: matched.length ? pairedTest(`slot-picks-${label}`, diffs((m) => m.picks)) : null,
	};
}).filter((pair) => pair.days);
holm(slotPairs.map((pair) => pair.streak.p)).forEach((adjusted, index) => { slotPairs[index].streak.adjusted = adjusted; });
holm(slotPairs.map((pair) => pair.picks.p)).forEach((adjusted, index) => { slotPairs[index].picks.adjusted = adjusted; });
results.slots = { rows: slotRows, pairs: slotPairs };

// --- 3. Sportsbooks: the top ticket of each subset of the books, the Avg's among them ------------

// Only windows where every subset has a ticket, so every subset is measured on the same windows
const common = windows.filter((window) => SUBSET_KEYS.every((key) => window.books[key]));
const commonByDay = groupBy(common, (window) => window.day);
const bookRows = SUBSET_KEYS.map((key) => {
	const list = common.map((window) => metric(window, key));
	const differs = common.filter((window) => window.books[key].top.ticket !== window.books.betAvg.top.ticket);
	const values = common.map((window) => ({ day: dayIndex.get(window.day), value: metric(window, key).streak }));
	const byDay = groupBy(values, (entry) => entry.day);
	const daySums = [...byDay.values()].map((entries) => ({ sum: total(entries, (entry) => entry.value), count: entries.length }));
	const draws = bootstrap(`book-${key}`, daySums.length, (pick) => {
		let sum = 0;
		let count = 0;
		for (const index of pick) {
			sum += daySums[index].sum;
			count += daySums[index].count;
		}
		return sum / count;
	});
	return {
		key, windows: list.length, differs: differs.length,
		differsStreak: average(differs, (window) => metric(window, key).streak), differsAvgStreak: average(differs, (window) => metric(window).streak),
		oddsStreak: average(list, (m) => m.oddsStreak), streak: average(list, (m) => m.streak), interval: interval(draws),
		oddsPicks: average(list, (m) => m.oddsPicks), picks: average(list, (m) => m.picks), points: average(list, (m) => m.points),
	};
});
const anySubset = {};
for (const measure of ['streak', 'picks']) {
	const daySums = [...commonByDay.values()].map((list) => SUBSET_KEYS.map((key) => total(list, (window) => metric(window, key)[measure])));
	anySubset[measure] = anyDifferenceP(`any-subset-${measure}`, daySums);
}
holm([anySubset.streak, anySubset.picks]).forEach((adjusted, index) => { anySubset[index ? 'picksAdjusted' : 'streakAdjusted'] = adjusted; });
const versusAvg = {};
for (const measure of ['streak', 'picks']) {
	versusAvg[measure] = ALTERNATIVES.map((key) => ({
		key,
		test: pairedTest(`versus-avg-${measure}-${key}`, [...commonByDay.values()].map((list) => ({
			sum: total(list, (window) => metric(window, key)[measure] - metric(window)[measure]), count: list.length,
		}))),
	}));
	holm(versusAvg[measure].map((entry) => entry.test.p)).forEach((adjusted, index) => { versusAvg[measure][index].test.adjusted = adjusted; });
}

// Player level: how well each subset's prices sort scorers from non-scorers, on players all four books priced
const fourBooks = playerDays.filter((row) => BOOKS.every((book) => row[book] !== null));
// How often a scorer is priced above a non-scorer, a tie counting half, with each day weighted by how often a
// bootstrap draw took it. The pairs are counted once for every pair of days, so a draw costs a sum over the days it
// took instead of a pass over every player-day. Every count is whole or half, so the sums are exact in any order
const aucOf = (rows, score) => {
	const size = days.length;
	const sorted = rows.map((row) => ({ score: score(row), positive: row.scored, day: row.dayIndex })).sort((a, b) => a.score - b.score);
	const above = new Float64Array(size * size); // [scorer's day * size + non-scorer's day]
	const scorers = new Float64Array(size);
	const others = new Float64Array(size); // by day, the non-scorers priced below the current price, and at the end all of them
	const tied = new Float64Array(size);
	for (let start = 0; start < sorted.length;) {
		let end = start;
		while (end < sorted.length && sorted[end].score === sorted[start].score) end += 1;
		for (let index = start; index < end; index += 1) if (!sorted[index].positive) tied[sorted[index].day] += 1;
		for (let index = start; index < end; index += 1) {
			if (!sorted[index].positive) continue;
			const day = sorted[index].day;
			scorers[day] += 1;
			for (let other = 0; other < size; other += 1) above[day * size + other] += others[other] + tied[other] / 2;
		}
		for (let index = start; index < end; index += 1) {
			const day = sorted[index].day;
			others[day] += tied[day];
			tied[day] = 0;
		}
		start = end;
	}
	const ones = new Float64Array(size).fill(1);
	return (weights = ones) => {
		const drawn = [];
		for (let day = 0; day < size; day += 1) if (weights[day]) drawn.push(day);
		let sum = 0;
		let positives = 0;
		let negatives = 0;
		for (const a of drawn) {
			let row = 0;
			for (const b of drawn) row += weights[b] * above[a * size + b];
			sum += weights[a] * row;
			positives += weights[a] * scorers[a];
			negatives += weights[a] * others[a];
		}
		return sum / (positives * negatives);
	};
};
const aucs = Object.fromEntries(SUBSET_KEYS.map((key) => [key, aucOf(fourBooks, (row) => row[key])]));
const playerRows = SUBSET_KEYS.map((key) => {
	const row = { key, implied: average(fourBooks, (player) => player[key]), auc: aucs[key]() };
	if (key !== 'betAvg') {
		const draws = bootstrap(`auc-${key}`, days.length, (pick) => {
			const weights = new Float64Array(days.length);
			for (const index of pick) weights[index] += 1;
			return aucs[key](weights) - aucs.betAvg(weights);
		});
		Object.assign(row, { diff: row.auc - aucs.betAvg(), interval: interval(draws), p: bootstrapP(draws, 0) });
	}
	return row;
});
holm(playerRows.filter((row) => row.key !== 'betAvg').map((row) => row.p)).forEach((adjusted, index) => { playerRows[index].adjusted = adjusted; });
const scoredRate = average(fourBooks, (row) => (row.scored ? 1 : 0));

// Each alternative against the Avg on per-day sums of one measure; read only where the any-subset test for the same windows is significant
const versusAvgOn = (label, byDay, measure) => {
	const versus = ALTERNATIVES.map((key) => ({
		key,
		test: pairedTest(`${label}-${key}`, byDay.map((list) => ({ sum: total(list, (window) => measure(window, key) - measure(window, 'betAvg')), count: list.length }))),
	}));
	holm(versus.map((entry) => entry.test.p)).forEach((adjusted, index) => { versus[index].test.adjusted = adjusted; });
	return versus;
};

// Per slot: the first window of each slot per day, the windows the audit reads when it weights the books for that slot
const perSlotBooks = BUCKETS.map((bucket) => {
	const list = [...firstOfBucket.values()].map((firsts) => firsts.get(bucket)).filter((window) => window && SUBSET_KEYS.every((key) => window.books[key]));
	const rates = Object.fromEntries(SUBSET_KEYS.map((key) => [key, average(list, (window) => metric(window, key).streak)]));
	const p = list.length ? anyDifferenceP(`slot-books-${bucket}`, list.map((window) => SUBSET_KEYS.map((key) => metric(window, key).streak))) : NaN;
	const versus = versusAvgOn(`slot-versus-${bucket}`, list.map((window) => [window]), (window, key) => metric(window, key).streak);
	return { bucket, days: list.length, rates, p, versus };
});
holm(perSlotBooks.map((row) => row.p)).forEach((adjusted, index) => { perSlotBooks[index].adjusted = adjusted; });

// Per pick pool: how often each subset's top player in each list scored. The lists are independent, so a subset's
// top ticket is its top player in every list, and a tie spreads the ticket evenly over the tied players
const scoredIn = new WeakMap();
const scoredOf = (window, id) => {
	if (!scoredIn.has(window)) scoredIn.set(window, new Map(window.rows.map((row) => [row.id, row.scored ? 1 : 0])));
	return scoredIn.get(window).get(id) ?? 0;
};
const poolHit = (window, key, list) => average(window.books[key].top.combos, (combo) => scoredOf(window, combo[list]));
const commonDays = [...commonByDay.values()];
const perPoolBooks = LISTS.map((sid, list) => ({
	sid,
	rates: Object.fromEntries(SUBSET_KEYS.map((key) => [key, average(common, (window) => poolHit(window, key, list))])),
	p: anyDifferenceP(`pool-books-${sid}`, commonDays.map((day) => SUBSET_KEYS.map((key) => total(day, (window) => poolHit(window, key, list))))),
	versus: versusAvgOn(`pool-versus-${sid}`, commonDays, (window, key) => poolHit(window, key, list)),
}));
holm(perPoolBooks.map((row) => row.p)).forEach((adjusted, index) => { perPoolBooks[index].adjusted = adjusted; });
results.books = { subsets: SUBSETS, rows: bookRows, anySubset, versusAvg, players: playerRows, fourBooks: fourBooks.length, perSlot: perSlotBooks, perPool: perPoolBooks };

// --- 4. Regular season vs playoffs ---------------------------------------------------------------

// Playoff days have fewer games, lower odds and the same two teams night after night, so a result could hold in
// one format and not the other, and the pooled result could hide that. Each primary result, and the player-level
// AUC, is measured within each format by the same test as the pooled one, and the two formats are compared
const FORMATS = ['regular', 'playoff'];
const formatName = (format) => (format === 'playoff' ? 'the playoffs' : 'the regular season');
const dayFormat = days.map((day) => formatOf.get(day));
const formatDays = FORMATS.map((format) => everyDay.filter((index) => dayFormat[index] === format));
const splitFormats = formatDays.every((list) => list.length >= 2);
const bounds = (sorted) => {
	const [low, high] = interval(sorted);
	return { low, high };
};
// With fewer days in a format, a bootstrap's interval of the contrast runs too narrow, and the sign flips rarely
// find even a large difference, so the row would only widen the Holm correction for the others
const comparable = (sizes) => sizes.every((size) => size >= CONTRAST_DAYS);
// Resamples each format's days on their own, so each keeps its size: each format's draws give its interval,
// and the draws taken together give the interval of the contrast between them
const bootstrapFormats = (label, sizes, statistic, contrast) => {
	const random = rngFor(label);
	const picks = sizes.map((size) => new Array(size));
	const each = sizes.map(() => []);
	const contrasts = [];
	for (let draw = 0; draw < options.boot; draw += 1) {
		const values = sizes.map((size, f) => {
			for (let index = 0; index < size; index += 1) picks[f][index] = Math.floor(random() * size);
			return statistic(f, picks[f]);
		});
		values.forEach((value, f) => { if (Number.isFinite(value)) each[f].push(value); });
		const value = contrast(values[0], values[1]);
		if (Number.isFinite(value)) contrasts.push(value);
	}
	return { each: each.map((list) => list.sort((a, b) => a - b)), contrasts: contrasts.sort((a, b) => a - b) };
};
// Whether paired differences change between the formats. Most days differ by a whole result or not at all, which
// resampling can't test with few days. Each day's differences keep or flip their sign together at random, as the
// paired test flips a day's difference, and every day stays in its format. Shuffling the days between the formats
// would take a format whose days differ at all more often for a difference, and find more of those the more days
// the other format adds. Each component's gap between the formats is scaled by its spread about zero, which
// flipping leaves as it is, so the test is exact when neither format has an effect, and errs safe when both have the
// same one. With several components (each alternative against the Avg), the largest is the statistic.
// Units: { f, sums, count }
const formatFlipP = (label, units, components) => {
	const counts = [0, 1].map((f) => total(units, (unit) => (unit.f === f ? unit.count : 0)));
	// Each day's part of each component's gap, the regular season's mean minus the playoffs'
	const parts = units
		.map((unit) => unit.sums.map((sum) => ((unit.f === 0 ? 1 : -1) * sum) / counts[unit.f]))
		.filter((values) => values.some((value) => Math.abs(value) > 1e-12));
	if (!parts.length) return 1;
	const scales = Array.from({ length: components }, (_, component) => Math.sqrt(total(parts, (values) => values[component] ** 2)));
	const statistic = (sign) => {
		let largest = 0;
		for (let component = 0; component < components; component += 1) {
			if (!scales[component]) continue;
			let gap = 0;
			parts.forEach((values, day) => { gap += sign(day) * values[component]; });
			largest = Math.max(largest, Math.abs(gap) / scales[component]);
		}
		return largest;
	};
	const observed = statistic(() => 1) * (1 - 1e-9);
	if (parts.length <= EXACT_SIGNS) {
		const patterns = 2 ** parts.length;
		let hits = 0;
		for (let mask = 0; mask < patterns; mask += 1) if (statistic((day) => ((mask >> day) & 1 ? -1 : 1)) >= observed) hits += 1;
		return hits / patterns;
	}
	const random = rngFor(label);
	const signs = new Float64Array(parts.length);
	let hits = 0;
	for (let draw = 0; draw < SIGN_DRAWS; draw += 1) {
		for (let day = 0; day < signs.length; day += 1) signs[day] = random() < 0.5 ? -1 : 1;
		if (statistic((day) => signs[day]) >= observed) hits += 1;
	}
	return (hits + 1) / (SIGN_DRAWS + 1);
};
// A paired difference from per-day sums, as pairedTest measures it, within each format
const formatPaired = (label, units) => {
	const parts = FORMATS.map((format) => units.filter((unit) => dayFormat[unit.day] === format));
	if (parts.some((part) => part.length < 2)) return null;
	const mean = (part, pick) => {
		let sum = 0;
		let count = 0;
		for (const index of pick) {
			sum += part[index].sum;
			count += part[index].count;
		}
		return sum / count;
	};
	const estimates = parts.map((part) => mean(part, part.keys()));
	const { each, contrasts } = bootstrapFormats(`format-${label}`, parts.map((part) => part.length), (f, pick) => mean(parts[f], pick), (a, b) => a - b);
	return {
		days: parts.map((part) => part.length),
		formats: parts.map((part, f) => ({ estimate: estimates[f], ...bounds(each[f]), p: signFlipP(`format-${label}-${FORMATS[f]}`, part.map((unit) => unit.sum)) })),
		contrast: {
			estimate: estimates[0] - estimates[1], ...bounds(contrasts),
			p: comparable(parts.map((part) => part.length))
				? formatFlipP(`format-flips-${label}`, parts.flatMap((part, f) => part.map((unit) => ({ f, sums: [unit.sum], count: unit.count }))), 1)
				: NaN,
		},
	};
};
// A pair lift within each format; the contrast is the ratio of the two lifts
const formatLift = (kind) => {
	const estimates = formatDays.map((list) => pooledLift(list, kind));
	const { each, contrasts } = bootstrapFormats(`format-pairs-${kind}`, formatDays.map((list) => list.length), (f, pick) => pooledLift(pick.map((index) => formatDays[f][index]), kind), (a, b) => a / b);
	return {
		days: formatDays.map((list) => list.length),
		formats: estimates.map((estimate, f) => ({ estimate, ...bounds(each[f]), p: bootstrapP(each[f], 1) })),
		contrast: { estimate: estimates[0] / estimates[1], ...bounds(contrasts), p: comparable(formatDays.map((list) => list.length)) ? bootstrapP(contrasts, 1) : NaN },
	};
};
// A subset's AUC minus the Avg's, within each format's player-days
const formatAucs = FORMATS.map((format) => {
	const rows = fourBooks.filter((row) => dayFormat[row.dayIndex] === format);
	return { rows: rows.length, auc: Object.fromEntries(SUBSET_KEYS.map((key) => [key, aucOf(rows, (row) => row[key])])) };
});
const formatAuc = (key) => {
	const weights = new Float64Array(days.length);
	const gap = (f, pick) => {
		weights.fill(0);
		for (const index of pick) weights[formatDays[f][index]] += 1;
		return formatAucs[f].auc[key](weights) - formatAucs[f].auc.betAvg(weights);
	};
	const estimates = FORMATS.map((_, f) => formatAucs[f].auc[key]() - formatAucs[f].auc.betAvg());
	const { each, contrasts } = bootstrapFormats(`format-auc-${key}`, formatDays.map((list) => list.length), gap, (a, b) => a - b);
	return {
		days: formatDays.map((list) => list.length),
		formats: estimates.map((estimate, f) => ({ estimate, ...bounds(each[f]), p: bootstrapP(each[f], 0) })),
		contrast: { estimate: estimates[0] - estimates[1], ...bounds(contrasts), p: comparable(formatDays.map((list) => list.length)) ? bootstrapP(contrasts, 0) : NaN },
	};
};
// The any-subset test within each format, each alternative against the Avg there (read only where that format's
// test is significant), and whether any alternative's gap to the Avg changes between the formats
const formatBooks = (measure) => {
	const parts = FORMATS.map((format) => commonDays.filter((list) => list[0].format === format));
	if (parts.some((part) => part.length < 2)) return null;
	const sums = parts.map((part) => part.map((list) => ({ values: SUBSET_KEYS.map((key) => total(list, (window) => metric(window, key)[measure])), count: list.length })));
	const avg = SUBSET_KEYS.indexOf('betAvg');
	const units = sums.flatMap((list, f) => list.map((day) => ({ f, sums: ALTERNATIVES.map((key) => day.values[SUBSET_KEYS.indexOf(key)] - day.values[avg]), count: day.count })));
	return {
		days: parts.map((part) => part.length),
		formats: parts.map((part, f) => ({
			rates: SUBSET_KEYS.map((_, subset) => total(sums[f], (day) => day.values[subset]) / total(sums[f], (day) => day.count)),
			p: anyDifferenceP(`format-books-${measure}-${FORMATS[f]}`, sums[f].map((day) => day.values)),
			versus: versusAvgOn(`format-versus-${measure}-${FORMATS[f]}`, part, (window, key) => metric(window, key)[measure]),
		})),
		contrast: { p: comparable(parts.map((part) => part.length)) ? formatFlipP(`format-flips-books-${measure}`, units, ALTERNATIVES.length) : NaN },
	};
};
const formatTests = [];
if (splitFormats) {
	const add = (test, result) => { if (result) formatTests.push({ ...test, ...result }); };
	for (const [kind, label] of [['same', 'teammates'], ['opp', 'opponents']]) add({ question: 'correlation', primary: true, type: 'lift', label }, formatLift(kind));
	for (const strategy of ['least1', 'points']) {
		const perDay = backtestDays.get(`betAvg|${strategy}`);
		if (!perDay) continue;
		add({ question: 'correlation', primary: true, type: 'backtest', strategy, label: `Avg ${strategyName(strategy)} backtest` },
			formatPaired(`backtest-${strategy}`, [...perDay].map(([day, entry]) => ({ day: dayIndex.get(day), ...entry }))));
	}
	for (const pair of slotPairs) {
		add({ question: 'time slot', primary: true, type: 'slot', a: pair.a, b: pair.b, label: `${pair.label}, Streak` },
			formatPaired(`slot-${pair.label}`, matchSlots(pair.a, pair.b).map(([x, y]) => ({ day: dayIndex.get(x.day), sum: metric(x).streak - metric(y).streak, count: 1 }))));
	}
	for (const measure of ['streak', 'picks']) {
		add({ question: 'sportsbooks', primary: true, type: 'books', measure, label: `any subset, ${measure === 'streak' ? 'Streak' : 'picks correct'}` }, formatBooks(measure));
	}
	for (const key of ALTERNATIVES) add({ question: 'sportsbooks', primary: false, type: 'auc', key, label: `${key}'s AUC vs the Avg's` }, formatAuc(key));
	// Holm within each family: the contrasts there were days enough for, and both formats' own tests together
	for (const tests of groupBy(formatTests, (test) => `${test.question}|${test.primary}`).values()) {
		const compared = tests.filter((test) => Number.isFinite(test.contrast.p));
		holm(compared.map((test) => test.contrast.p)).forEach((adjusted, index) => { compared[index].contrast.adjusted = adjusted; });
		const parts = tests.flatMap((test) => test.formats);
		holm(parts.map((part) => part.p)).forEach((adjusted, index) => { parts[index].adjusted = adjusted; });
	}
}
results.formats = { days: formatDays.map((list) => list.length), playerDays: formatAucs.map((entry) => entry.rows), tests: formatTests };

// --- Verdicts -----------------------------------------------------------------------------------

const backtestFormat = (strategy) => (strategy === 'points' ? (v) => signed(v, 2, 1, '') : (v) => signed(v));
const backtestText = (key, strategy, result) => {
	const format = backtestFormat(strategy);
	return `${keyName(key)} ${strategyName(strategy)} pick with correlation on (held out): ${format(result.test.estimate)} ${span([result.test.low, result.test.high], format)} per window`;
};
// Primary: the two pair lifts and the Avg's Streak and Points backtests, corrected together
const correlationPrimary = [
	{ target: pairs.same, text: `teammates both scored ${times(pairs.same.lift)} ${span(pairs.same.interval, (v) => v.toFixed(2))} as often as pairs from different games`, p: pairs.same.p },
	{ target: pairs.opp, text: `opponents both scored ${times(pairs.opp.lift)} ${span(pairs.opp.interval, (v) => v.toFixed(2))} as often as pairs from different games`, p: pairs.opp.p },
];
for (const strategy of ['least1', 'points']) {
	const result = backtest.betAvg?.[strategy];
	if (result) correlationPrimary.push({ target: result.test, text: backtestText('betAvg', strategy, result), p: result.test.p });
}
holm(correlationPrimary.map((test) => test.p)).forEach((adjusted, index) => {
	correlationPrimary[index].adjusted = adjusted;
	correlationPrimary[index].target.adjusted = adjusted;
});
// Secondary: the other books' backtests, corrected together. The near-top tests are a family of their own
const otherBacktests = KEYS.filter((key) => key !== 'betAvg').flatMap((key) => CORRELATED.map((strategy) => backtest[key][strategy])).filter(Boolean);
holm(otherBacktests.map((result) => result.test.p)).forEach((adjusted, index) => { otherBacktests[index].test.adjusted = adjusted; });
const slotPrimary = slotPairs.map((pair) => ({
	text: `${pair.label}: Streak ${signed(pair.streak.estimate)} ${span([pair.streak.low, pair.streak.high], (v) => signed(v))} over ${plural(pair.days, 'day')} (better on ${pair.aBetter} vs ${pair.bBetter})`,
	p: pair.streak.p, adjusted: pair.streak.adjusted,
}));
// The smallest Holm p, and among equal ones (often 1.000) the smallest raw p
const nearer = (a, b) => a.adjusted < b.adjusted || (a.adjusted === b.adjusted && a.p < b.p);
const closest = (tests) => tests.reduce((best, test) => (!best || nearer(test, best) ? test : best), null);
const verdictLine = (tests) => {
	const hits = tests.filter((test) => test.adjusted < ALPHA);
	if (hits.length) return `SIGNIFICANT: ${hits.map((test) => `${test.text} (p ${pText(test.p)}, Holm ${pText(test.adjusted)})`).join('; ')}`;
	const best = closest(tests);
	return best ? `nothing significant. Closest: ${best.text} (p ${pText(best.p)}, Holm ${pText(best.adjusted)})` : 'nothing to test';
};
const nearTopText = (label, test) => `near the top of the lists, ${label} both scored ${times(test.near)} as often as their odds say, against ${times(test.rest)} for the other pairs (${times(test.ratio)} ${span(test.interval, (v) => v.toFixed(2))})`;
const bookHits = [];
for (const measure of ['streak', 'picks']) {
	if (anySubset[`${measure}Adjusted`] >= ALPHA) continue;
	for (const entry of versusAvg[measure]) if (entry.test.adjusted < ALPHA) bookHits.push(`${entry.key} vs Avg on ${measure === 'streak' ? 'Streak' : 'picks'}: ${signed(entry.test.estimate)} (Holm ${pText(entry.test.adjusted)})`);
}

// Every result significant after Holm within its own family. Primary results decide the conclusion; secondary
// ones are listed for rechecking as the archive grows. `favors` says what a result means for the default pick,
// the top Avg player in each pick pool: 'other' when something beats it, 'when' for a better time to pick,
// 'avg' when the alternative did worse, 'none' when it says nothing about the pick
const findings = [];
const consider = (finding) => {
	if (finding.adjusted < ALPHA) findings.push(finding);
};
const ciText = (test, format) => span([test.low, test.high], format);
// What a result would change in the picks, worded the same for the pooled result and for one format's
const slotName = (side) => (side === 'first' || side === 'last' ? `at the day's ${side} window` : `with ${bucketName(side)} left`);
const liftShort = (label, lift) => `${lift > 1 ? 'keeping' : 'putting'} ${label} ${lift > 1 ? 'apart on Streak tickets and together on Points tickets' : 'together on Streak tickets and apart on Points tickets'} (they score together ${times(lift)} as often as their odds say)`;
const backtestShort = (strategy, estimate) => `correlation on for the Avg ${strategyName(strategy)} pick (${backtestFormat(strategy)(estimate)} per window)`;
const slotShort = (a, b, estimate, label) => {
	const [winner, loser] = estimate > 0 ? [a, b] : [b, a];
	return `picking ${slotName(winner)} rather than ${slotName(loser)} (${signed(Math.abs(estimate))} ${label} on the same days)`;
};
const aucShort = (key, diff) => `${key}'s prices (AUC ${signed(diff, 4, 1, '')} against the Avg's)`;
for (const [kind, label] of [['same', 'teammates'], ['opp', 'opponents']]) {
	const pair = pairs[kind];
	consider({
		primary: true, question: 'correlation', p: pair.p, adjusted: pair.adjusted,
		text: `${label} both scored ${times(pair.lift)} ${span(pair.interval, (v) => v.toFixed(2))} as often as pairs from different games`, favors: 'other',
		short: liftShort(label, pair.lift),
	});
}
for (const key of KEYS) {
	for (const strategy of CORRELATED) {
		const result = backtest[key][strategy];
		if (!result) continue;
		const avg = key === 'betAvg';
		consider({
			primary: avg, question: 'correlation', p: result.test.p, adjusted: result.test.adjusted, text: backtestText(key, strategy, result),
			favors: !avg ? 'none' : result.test.estimate > 0 ? 'other' : 'avg',
			short: backtestShort(strategy, result.test.estimate),
		});
	}
}
for (const [kind, label] of [['same', 'teammates'], ['opp', 'opponents']]) {
	const test = nearTopTests[kind];
	consider({
		primary: false, question: 'correlation', p: test.p, adjusted: test.adjusted, favors: 'none', fit: true, text: nearTopText(label, test),
		short: `${label} near the top of the lists score together ${times(test.near)} as often as their odds say, against ${times(test.rest)} for the other pairs`,
	});
}
for (const pair of slotPairs) {
	for (const [measure, label, primary] of [['streak', 'Streak', true], ['picks', 'picks correct', false]]) {
		const test = pair[measure];
		consider({
			primary, question: 'time slot', p: test.p, adjusted: test.adjusted, favors: 'when',
			text: `${pair.label}: ${label} ${signed(test.estimate)} ${ciText(test, (v) => signed(v))} over ${plural(pair.days, 'day')}`,
			short: slotShort(pair.a, pair.b, test.estimate, label),
		});
	}
}
const versusFindings = (versus, primary, where, label) => {
	for (const entry of versus) {
		consider({
			primary, question: 'sportsbooks', p: entry.test.p, adjusted: entry.test.adjusted, favors: entry.test.estimate > 0 ? 'other' : 'avg',
			text: `${entry.key} vs Avg${where}, ${label}: ${signed(entry.test.estimate)} ${ciText(entry.test, (v) => signed(v))}`,
			short: `${entry.key}'s pick${where} instead of the Avg's (${signed(entry.test.estimate)} ${label})`,
		});
	}
};
for (const measure of ['streak', 'picks']) {
	const label = measure === 'streak' ? 'Streak' : 'picks correct';
	const adjusted = anySubset[`${measure}Adjusted`];
	consider({ primary: true, question: 'sportsbooks', p: anySubset[measure], adjusted, favors: 'none', text: `the ${SUBSET_KEYS.length} subsets' ${label} rates differ (any-subset test)` });
	if (adjusted < ALPHA) versusFindings(versusAvg[measure], true, '', label);
}
for (const row of playerRows) {
	if (row.key === 'betAvg') continue;
	consider({
		primary: false, question: 'sportsbooks', p: row.p, adjusted: row.adjusted, favors: row.diff > 0 ? 'other' : 'avg',
		text: `${row.key}'s AUC vs the Avg's: ${signed(row.diff, 4, 1, '')} ${span(row.interval, (v) => signed(v, 4, 1, ''))}`,
		short: aucShort(row.key, row.diff),
	});
}
for (const [rows, name, label] of [[perSlotBooks, (row) => `${bucketName(row.bucket)} windows`, 'Streak'], [perPoolBooks, (row) => `Pick #${row.sid}`, 'scored']]) {
	for (const row of rows) {
		consider({ primary: false, question: 'sportsbooks', p: row.p, adjusted: row.adjusted, favors: 'none', text: `subsets differ in ${name(row)} (any-subset test)` });
		if (row.adjusted < ALPHA) versusFindings(row.versus, false, ` in ${name(row)}`, label);
	}
}
// Regular season vs playoffs. A result within one format is primary only when its pooled test is primary and the
// result also differs significantly between the formats; otherwise the pooled result stands, and it's for rechecking
const FORMAT_QUESTION = 'regular season vs playoffs';
const formatValue = (test, value) => (test.type === 'lift' ? times(value) : test.type === 'auc' ? signed(value, 4, 1, '') : test.type === 'backtest' ? backtestFormat(test.strategy)(value) : signed(value));
const formatCell = (test, part) => {
	if (test.type === 'books') return part.rates ? `${pct(Math.min(...part.rates), 0)}–${pct(Math.max(...part.rates), 0)}` : '';
	const bound = test.type === 'lift' ? (v) => v.toFixed(2) : (v) => formatValue(test, v);
	return `${formatValue(test, part.estimate)} ${ciText(part, bound)}`;
};
const formatContrastText = (test) => (test.type === 'books'
	? `${test.label}: the subsets' gaps to the Avg differ between the regular season and the playoffs`
	: `${test.label}: ${formatCell(test, test.formats[0])} in the regular season, ${formatCell(test, test.formats[1])} in the playoffs (${test.type === 'lift' ? 'ratio' : 'difference'} ${formatCell(test, test.contrast)})`);
for (const test of formatTests) {
	const differs = test.contrast.adjusted < ALPHA;
	consider({
		primary: test.primary, question: FORMAT_QUESTION, p: test.contrast.p, adjusted: test.contrast.adjusted, favors: 'none', text: formatContrastText(test),
		short: test.type === 'books'
			? `the subsets' gaps to the Avg on ${test.measure === 'streak' ? 'Streak' : 'picks correct'}`
			: `${test.label} (${formatValue(test, test.formats[0].estimate)} in the regular season, ${formatValue(test, test.formats[1].estimate)} in the playoffs)`,
	});
	test.formats.forEach((part, f) => {
		const format = FORMATS[f];
		const primary = test.primary && differs;
		const where = `in ${formatName(format)}, `;
		if (test.type === 'books') {
			const label = test.measure === 'streak' ? 'Streak' : 'picks correct';
			consider({ primary, question: 'sportsbooks', format, p: part.p, adjusted: part.adjusted, favors: 'none', text: `${where}the ${SUBSET_KEYS.length} subsets' ${label} rates differ (any-subset test)` });
			if (part.adjusted >= ALPHA) return;
			for (const entry of part.versus) {
				consider({
					primary, question: 'sportsbooks', format, p: entry.test.p, adjusted: entry.test.adjusted, favors: entry.test.estimate > 0 ? 'other' : 'avg',
					text: `${where}${entry.key} vs Avg, ${label}: ${signed(entry.test.estimate)} ${ciText(entry.test, (v) => signed(v))}`,
					short: `${entry.key}'s pick instead of the Avg's (${signed(entry.test.estimate)} ${label})`,
				});
			}
			return;
		}
		const favors = test.type === 'slot' ? 'when' : test.type === 'lift' ? 'other' : part.estimate > 0 ? 'other' : 'avg';
		const short = test.type === 'lift' ? liftShort(test.label, part.estimate)
			: test.type === 'backtest' ? backtestShort(test.strategy, part.estimate)
				: test.type === 'slot' ? slotShort(test.a, test.b, part.estimate, 'Streak') : aucShort(test.key, part.estimate);
		consider({ primary, question: test.question, format, p: part.p, adjusted: part.adjusted, favors, text: `${where}${test.label}: ${formatCell(test, part)} over ${plural(test.days[f], 'day')}`, short });
	});
}
const shortOf = (finding) => `${finding.format ? `in ${formatName(finding.format)}, ` : ''}${finding.short}`;
const shorts = (list) => list.map(shortOf).join('; ');
const primaryOther = findings.filter((finding) => finding.primary && finding.favors === 'other' && !finding.format);
const formatOther = findings.filter((finding) => finding.primary && finding.favors === 'other' && finding.format);
const primaryWhen = findings.filter((finding) => finding.primary && finding.favors === 'when');
const secondaryBeats = findings.filter((finding) => !finding.primary && (finding.favors === 'other' || finding.favors === 'when'));
const worse = findings.filter((finding) => finding.favors === 'avg');
const formatDiffers = findings.filter((finding) => finding.question === FORMAT_QUESTION);
const fitNearTop = findings.filter((finding) => finding.fit);
const AVG_PICK = 'selecting the top Avg player in each pick pool (the app\'s Avg pick, with correlation off)';
const formatsBeaten = FORMATS.filter((format) => formatOther.some((finding) => finding.format === format));
const holdsIn = FORMATS.filter((format) => !formatsBeaten.includes(format));
const conclusion = [
	primaryOther.length
		? `the top Avg player in each pick pool is no longer the clear best option. Significant: ${shorts(primaryOther)}`
		: !formatsBeaten.length
			? `${AVG_PICK} is the best option: no alternative tested beats it significantly`
			: holdsIn.length && `${AVG_PICK} is the best option in ${holdsIn.map(formatName).join(' and ')}: no alternative tested beats it significantly there`,
	...formatsBeaten.map((format) => `in ${formatName(format)}, the top Avg player in each pick pool is no longer the clear best option. Significant there: ${formatOther.filter((finding) => finding.format === format).map((finding) => finding.short).join('; ')}`),
	primaryWhen.length && `significant on when to pick: ${shorts(primaryWhen)}`,
	worse.length && `significantly worse than the Avg pick: ${shorts(worse)}`,
	secondaryBeats.length && `secondary results to recheck as the archive grows: ${shorts(secondaryBeats)}`,
	fitNearTop.length && `the lifts the app fits on every pair may not hold for the players the picks come from, so fitting them near the top of the lists is worth considering: ${shorts(fitNearTop)}`,
	formatDiffers.length && `results that differ between the regular season and the playoffs: ${shorts(formatDiffers)}`,
].filter(Boolean).map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join('. ');
results.findings = findings;
results.conclusion = conclusion;

// --- Report -------------------------------------------------------------------------------------

const daysByFormat = new Map();
for (const day of coverage.days) {
	const key = `${manifest.find((range) => range.files.some((file) => dayOfFile(file) === day))?.season} ${formatOf.get(day)}`;
	daysByFormat.set(key, (daysByFormat.get(key) ?? 0) + 1);
}
say(`# Archive analysis, ${etStamp(new Date())} ET`);
say('');
say(`History: ${plural(coverage.days.length, 'day')}, ${coverage.days[0]} to ${coverage.days.at(-1)} (${[...daysByFormat].map(([key, count]) => `${key} ${count}`).join(', ')})`);
say(`Snapshots: ${roots.map(rootName).join(', then ')}; history from all of them`);
say(`Windows: ${plural(windows.length, 'window')} on ${plural(days.length, 'day')}, ${plural(common.length, 'window')} with a ticket from all ${SUBSET_KEYS.length} subsets of the books`);
const skipped = [
	coverage.missingFiles.length && `${coverage.missingFiles.length} without a list or book file (${coverage.missingFiles.slice(0, SHOW).join(', ')}${coverage.missingFiles.length > SHOW ? ', …' : ''})`,
	coverage.noPlayers.length && `${coverage.noPlayers.length} with no listed player found in that day's history`,
	coverage.emptyList.length && `${coverage.emptyList.length} with a list where no player had ${minSportsbooks}+ books (${coverage.emptyList.slice(0, SHOW).join(', ')})`,
].filter(Boolean);
if (skipped.length) say(`  skipped, as the app's replays skip them: ${skipped.join('; ')}`);
if (coverage.noWindows.length) say(`  history days with no usable window: ${coverage.noWindows.join(', ')}`);
if (coverage.notInHistory) say(`  ${plural(coverage.notInHistory, 'list entry', 'list entries')} missing from that day's history, skipped as the app skips them`);
if (coverage.borrowed.length) say(`  snapshot folders taken from a later folder: ${coverage.borrowed.join(', ')}`);
say(`Books: ${BOOKS.map((book) => `${book} (${app.Sportsbooks?.[book]?.title ?? '?'})`).join(', ')}; Avg is their average for players priced by ${minSportsbooks}+, and a pair or triple averages its books that price the player`);
if (rebuildOk) say(`Rebuild check: the rebuilt windows give runSimulation's lifts exactly (all ${LIFT_FIELDS.length} values), so this analysis sees what the app sees`);
else if (rebuildDiffer) say(`Rebuild check: FAILED, runSimulation's lifts differ from the rebuilt windows' (runSimulation vs rebuild: ${differText(appLifts, rebuildDiffer)}). Don't trust the numbers below until this is fixed`);
else say(`Rebuild check: FAILED, runSimulation didn't run (${appLiftsError}). Don't trust the numbers below until this is fixed`);
say(`src/correlationData.ts: ${shippedDiffer.length ? `differs from this archive's lifts (shipped vs this archive: ${differText(app.shippedLifts, shippedDiffer)})` : `matches this archive's lifts (all ${LIFT_FIELDS.length} values)`}`);
say(`Settings: ${minSportsbooks}+ books per player, ${app.normalizeSportsbooks ? 'de-vigged' : 'no de-vig'}, archive from ${oldestDay ?? 'the start'}${options.since || options.until || options.format ? `; options: ${[options.since && `since ${options.since}`, options.until && `until ${options.until}`, options.format].filter(Boolean).join(', ')}` : ''}`);
say(`Tests: two-sided at ${ALPHA} after Holm correction within each question; resampling draws whole days (${options.boot.toLocaleString('en-US')} draws, seed ${options.seed})`);
for (const note of notes) say(`Note: ${note}`);
if (ignored.length) say(`Note: ignored ${ignored.join(' ')}`);

section('Verdicts');
say(`Correlation: ${verdictLine(correlationPrimary)}`);
say(`  Near the top of the lists: ${['same', 'opp'].map((kind) => {
	const test = nearTopTests[kind];
	return `${kind === 'same' ? 'teammates' : 'opponents'} ${times(test.near)} against ${times(test.rest)} for the other pairs (p ${pText(test.p)}, Holm ${pText(test.adjusted)})${test.adjusted < ALPHA ? ', SIGNIFICANT' : ''}`;
}).join('; ')}`);
say(`Time slot: ${verdictLine(slotPrimary)}`);
const anySubsetText = `any-subset test p ${pText(anySubset.streak)} on Streak, ${pText(anySubset.picks)} on picks (Holm ${pText(anySubset.streakAdjusted)}, ${pText(anySubset.picksAdjusted)})`;
say(`Sportsbooks: ${anySubset.streakAdjusted < ALPHA || anySubset.picksAdjusted < ALPHA ? `SIGNIFICANT: ${anySubsetText}${bookHits.length ? `; ${bookHits.join('; ')}` : '; no single subset differs from the Avg after Holm'}` : `no subset of the books picks differently from the others: ${anySubsetText}`}`);
if (formatTests.length) {
	const contrasts = formatTests.filter((test) => Number.isFinite(test.contrast.p)).map((test) => ({ text: formatContrastText(test), p: test.contrast.p, adjusted: test.contrast.adjusted }));
	const differ = contrasts.filter((test) => test.adjusted < ALPHA);
	const nearest = closest(contrasts);
	say(`Regular season vs playoffs: ${differ.length
		? `SIGNIFICANT: ${differ.map((test) => `${test.text} (p ${pText(test.p)}, Holm ${pText(test.adjusted)})`).join('; ')}`
		: nearest ? `no result differs between them. Closest: ${nearest.text} (p ${pText(nearest.p)}, Holm ${pText(nearest.adjusted)})` : `nothing to compare: no result has ${CONTRAST_DAYS}+ days in both`}`);
	const within = formatTests.flatMap((test) => (test.type === 'books' ? [] : test.formats.map((part, f) => ({ test, part, format: FORMATS[f] }))));
	const withinHits = within.filter(({ part }) => part.adjusted < ALPHA);
	const withinNearest = within.reduce((best, entry) => (!best || nearer(entry.part, best.part) ? entry : best), null);
	const withinText = ({ test, part, format }) => `in ${formatName(format)}, ${test.label}: ${formatCell(test, part)} (p ${pText(part.p)}, Holm ${pText(part.adjusted)})`;
	const booksWithin = formatTests.filter((test) => test.type === 'books').flatMap((test) => test.formats.map((part, f) => `${test.label} in ${formatName(FORMATS[f])} p ${pText(part.p)} (Holm ${pText(part.adjusted)})`));
	say(`  Within each format: ${withinHits.length ? `SIGNIFICANT: ${withinHits.map(withinText).join('; ')}` : `nothing significant. Closest: ${withinNearest ? withinText(withinNearest) : '-'}`}`);
	if (booksWithin.length) say(`  Any-subset tests within each format: ${booksWithin.join(', ')}`);
} else {
	const only = FORMATS.filter((_, f) => formatDays[f].length);
	say(`Regular season vs playoffs: not compared; this run has ${only.length === 1 ? `${formatName(only[0])} only` : 'too few days in one format'}`);
}
say('');
if (findings.length) {
	say('Significant results (after Holm within each family):');
	for (const finding of findings) say(`  ${finding.primary ? 'primary' : 'secondary'}, ${finding.question}: ${finding.text} (p ${pText(finding.p)}, Holm ${pText(finding.adjusted)})`);
} else say('Significant results: none, primary or secondary, after Holm within each family.');
say(`Conclusion: ${conclusion}.`);

section('1. Correlation');
sub('Do teammates or opponents score together? (player level)');
say(`${plural(playerDays.length, 'player-day')} on ${plural(days.length, 'day')}; each player's Avg price from the first window listing him that day`);
table(['pairs on one day', 'pairs', 'both scored', 'at their odds', 'ratio', 'vs different games', '95% CI', 'p'], [
	...['same', 'opp'].map((kind) => [kind === 'same' ? 'teammates' : 'opponents', pairs[kind].pairs.toLocaleString('en-US'), pairs[kind].both, pairs[kind].expected.toFixed(1),
		(pairs[kind].both / pairs[kind].expected).toFixed(3), times(pairs[kind].lift), span(pairs[kind].interval, (v) => v.toFixed(2)), pText(pairs[kind].p)]),
	['different games', pairs.diff.pairs.toLocaleString('en-US'), pairs.diff.both, pairs.diff.expected.toFixed(1), (pairs.diff.both / pairs.diff.expected).toFixed(3), 'control', '', ''],
]);
say('"At their odds" assumes independence at the Avg prices, which carry the books\' margin, so every ratio sits below 1.');
say('"vs different games" compares each day\'s pairs with that day\'s different-game pairs, which cancels the margin; 1 means no correlation.');

sub('Near the top of the lists (secondary)');
say(`Pairs where both players' Avg prices were within ${Math.round((1 - NEAR_TOP) * 100)}% of the top of their lists, the players the picks come from,`);
say('against all other pairs, each measured as above. The app fits its lifts on every pair; a significant difference would mean');
say('fitting them on these pairs instead. The cutoff was chosen, not calibrated.');
table(['pairs on one day', 'near-top pairs', 'both scored', 'near the top', '95% CI', 'other pairs', 'near vs other', '95% CI', 'p', 'Holm'], ['same', 'opp'].map((kind) => {
	const test = nearTopTests[kind];
	return [kind === 'same' ? 'teammates' : 'opponents', test.pairs.toLocaleString('en-US'), test.both, times(test.near), span(test.nearInterval, (v) => v.toFixed(2)),
		times(test.rest), times(test.ratio), span(test.interval, (v) => v.toFixed(2)), pText(test.p), pText(test.adjusted)];
}));

sub('Backtest: the app\'s pick with correlation on vs off');
say('Per book and strategy, every window, the best of every ticket valued with the lifts; "held out" refits the lifts without the window\'s own day.');
say('Difference and test are held out minus off. Pick% isn\'t backtested: correlation can\'t change the expected number of correct picks.');
for (const strategy of CORRELATED) {
	const format = strategy === 'points' ? pts : (v) => pct(v);
	const diffFormat = backtestFormat(strategy);
	say('');
	say(`${strategyName(strategy)}${strategy === 'points' ? ' (points per window)' : ' (at least one correct)'}`);
	table(['book', 'windows', 'changed', 'off', 'on, in sample', 'on, held out', 'difference', '95% CI', 'p', 'Holm'], KEYS.filter((key) => backtest[key][strategy]).map((key) => {
		const result = backtest[key][strategy];
		return [keyName(key), result.windows, result.changed, format(result.off), format(result.inSample), format(result.heldOut),
			diffFormat(result.test.estimate), span([result.test.low, result.test.high], diffFormat), pText(result.test.p), pText(result.test.adjusted)];
	}));
}
say('');
say('Holm: the Avg\'s Streak and Points rows with the pair tests (primary); every other row together (secondary).');

section('2. Time slot (slot = games left in the lists, the app\'s Pool Slots)');
say('The Avg top ticket, which is also every strategy\'s pick with correlation off. First window of each slot per day.');
table(['slot', 'days', 'Streak odds', 'Streak actual', '95% CI', 'picks correct', 'points odds', 'points actual'], slotRows.map((row) => [
	bucketName(row.bucket), row.days, pct(row.odds), pct(row.actual), span(row.interval, (v) => pct(v, 0)), pct(row.picks), pts(row.oddsPoints), pts(row.points),
]));
if (slotRows.some((row) => row.byFormat.regular.days && row.byFormat.playoff.days)) {
	say('');
	say('By format (the slots\' mix of regular season and playoff days differs, so compare same-day pairs below):');
	table(['slot', 'regular days', 'odds', 'actual', 'playoff days', 'odds', 'actual'], slotRows.map((row) => [
		bucketName(row.bucket), row.byFormat.regular.days, pct(row.byFormat.regular.odds), pct(row.byFormat.regular.actual),
		row.byFormat.playoff.days, pct(row.byFormat.playoff.odds), pct(row.byFormat.playoff.actual),
	]));
}
say('');
say('Same-day comparisons: days that had both. Streak is the primary test (Holm over these rows); picks is secondary.');
table(['comparison', 'days', 'better on', 'odds diff', 'Streak diff', '95% CI', 'p', 'Holm', 'picks diff', 'p', 'Holm'], slotPairs.map((pair) => [
	pair.label, pair.days, `${pair.aBetter} vs ${pair.bBetter}`, signed(pair.oddsDiff), signed(pair.streak.estimate), span([pair.streak.low, pair.streak.high], (v) => signed(v)),
	pText(pair.streak.p), pText(pair.streak.adjusted), signed(pair.picks.estimate), pText(pair.picks.p), pText(pair.picks.adjusted),
]));

section('3. Sportsbooks');
say('The top ticket of each subset of the books: each book alone, each pair and each triple, and all four, which is the Avg. A subset prices a player');
say(`at the average of its books that price him, among the players with ${minSportsbooks}+ books, on the ${plural(common.length, 'window')} where all ${SUBSET_KEYS.length} have a ticket.`);
table(['books', 'differs from Avg', 'Streak odds', 'Streak actual', '95% CI', 'picks odds', 'picks actual', 'points'], bookRows.map((row) => [
	keyName(row.key), row.key === 'betAvg' ? '' : `${row.differs}${row.differs ? ` (${pct(row.differsStreak, 0)} vs ${pct(row.differsAvgStreak, 0)})` : ''}`,
	pct(row.oddsStreak), pct(row.streak), span(row.interval, (v) => pct(v, 0)), pct(row.oddsPicks), pct(row.picks), pts(row.points),
]));
say('"Differs from Avg": windows where the subset\'s ticket isn\'t the Avg\'s, with both tickets\' Streak rate there. Only those windows can separate them.');
say('');
say(`Any subset different (each day's deviations from its mean flipped in sign together): Streak p ${pText(anySubset.streak)}, picks p ${pText(anySubset.picks)}; Holm ${pText(anySubset.streakAdjusted)}, ${pText(anySubset.picksAdjusted)}`);
table(['vs Avg', 'Streak diff', '95% CI', 'p', 'Holm', 'picks diff', '95% CI', 'p', 'Holm'], ALTERNATIVES.map((key, index) => {
	const streak = versusAvg.streak[index].test;
	const picks = versusAvg.picks[index].test;
	return [key, signed(streak.estimate), span([streak.low, streak.high], (v) => signed(v, 1)), pText(streak.p), pText(streak.adjusted),
		signed(picks.estimate), span([picks.low, picks.high], (v) => signed(v, 1)), pText(picks.p), pText(picks.adjusted)];
}));
say('');
say(`Player level: ${plural(fourBooks.length, 'player-day')} priced by all four books (first window each day); ${pct(scoredRate)} scored. AUC is how often a scorer is priced above a non-scorer.`);
table(['books', 'implied', 'AUC', 'vs Avg', '95% CI', 'p', 'Holm'], playerRows.map((row) => [
	keyName(row.key), pct(row.implied), row.auc.toFixed(4), row.key === 'betAvg' ? '' : signed(row.diff, 4, 1, ''),
	row.key === 'betAvg' ? '' : span(row.interval, (v) => signed(v, 4, 1, '')), row.key === 'betAvg' ? '' : pText(row.p), row.key === 'betAvg' ? '' : pText(row.adjusted),
]));
say('');
const versusRows = (rows, name) => {
	for (const row of rows.filter((entry) => entry.adjusted < ALPHA)) {
		say(`${name(row)}, each subset vs the Avg (Holm over the ${ALTERNATIVES.length}):`);
		table(['vs Avg', 'difference', '95% CI', 'p', 'Holm'], row.versus.map((entry) => [
			entry.key, signed(entry.test.estimate), ciText(entry.test, (v) => signed(v)), pText(entry.test.p), pText(entry.test.adjusted),
		]));
	}
};
say(`By pick pool: how often each subset's top player in each list scored, on the ${plural(common.length, 'window')}. The Avg is the best guide for a pool unless that pool's any-subset test is significant.`);
table(['books', ...perPoolBooks.map((row) => `Pick #${row.sid}`)], [
	...SUBSET_KEYS.map((key) => [keyName(key), ...perPoolBooks.map((row) => pct(row.rates[key]))]),
	['any subset p', ...perPoolBooks.map((row) => pText(row.p))],
	['Holm', ...perPoolBooks.map((row) => pText(row.adjusted))],
]);
versusRows(perPoolBooks, (row) => `Pick #${row.sid}`);
say('');
say('By slot: the first window of each slot per day, the windows the app\'s audit reads when it weights the books for Best Streak Picks.');
table(['books', ...perSlotBooks.map((row) => bucketName(row.bucket))], [
	['days', ...perSlotBooks.map((row) => row.days)],
	...SUBSET_KEYS.map((key) => [keyName(key), ...perSlotBooks.map((row) => pct(row.rates[key], 0))]),
	['any subset p', ...perSlotBooks.map((row) => pText(row.p))],
	['Holm', ...perSlotBooks.map((row) => pText(row.adjusted))],
]);
versusRows(perSlotBooks, (row) => `${bucketName(row.bucket)} windows`);

if (formatTests.length) {
	section('4. Regular season vs playoffs');
	const seasonsOf = (format) => [...daysByFormat].filter(([key]) => key.endsWith(` ${format}`)).map(([key, count]) => `${key.split(' ')[0]} ${count}`).join(', ');
	say(FORMATS.map((format, f) => {
		const name = formatName(format).replace(/^the /, '');
		return `${name[0].toUpperCase()}${name.slice(1)}: ${plural(formatDays[f].length, 'day')} (${seasonsOf(format)}), ${plural(windows.filter((window) => window.format === format).length, 'window')}`;
	}).join('; '));
	say('Each result within each format, by the same test as the pooled one. Intervals resample days within each format.');
	say('Holm runs over both formats\' tests in each family, and over the differences on their own. The difference is the regular season\'s minus the playoffs\' (for the lifts, their ratio).');
	say('A result within one format is primary only when the difference is significant too; otherwise the pooled result above stands.');
	const formatTable = (title, tests) => {
		if (!tests.length) return;
		say('');
		say(title);
		table(['result', 'days', 'regular season', 'p', 'Holm', 'playoffs', 'p', 'Holm', 'difference', 'p', 'Holm'], tests.map((test) => [
			test.label, test.days.join('/'),
			...test.formats.flatMap((part) => [formatCell(test, part), pText(part.p), pText(part.adjusted)]),
			Number.isFinite(test.contrast.p) ? formatCell(test, test.contrast) : '-', pText(test.contrast.p), pText(test.contrast.adjusted),
		]));
	};
	formatTable('Correlation (primary): the pair lifts and the Avg\'s held-out backtests', formatTests.filter((test) => test.question === 'correlation'));
	formatTable('Time slot (primary): same-day comparisons of the Avg top ticket', formatTests.filter((test) => test.question === 'time slot'));
	formatTable(`Sportsbooks (primary): the range of the ${SUBSET_KEYS.length} subsets' rates; the difference tests whether their gaps to the Avg change`, formatTests.filter((test) => test.type === 'books'));
	formatTable(`Player level (secondary): each subset's AUC minus the Avg's, over ${formatAucs.map((entry) => entry.rows.toLocaleString('en-US')).join(' and ')} player-days`, formatTests.filter((test) => test.type === 'auc'));
	for (const test of formatTests.filter((entry) => entry.type === 'books')) {
		test.formats.forEach((part, f) => {
			if (part.adjusted >= ALPHA) return;
			say('');
			say(`In ${formatName(FORMATS[f])}, ${test.label}: each subset vs the Avg (Holm over the ${ALTERNATIVES.length}):`);
			table(['vs Avg', 'difference', '95% CI', 'p', 'Holm'], part.versus.map((entry) => [
				entry.key, signed(entry.test.estimate), ciText(entry.test, (v) => signed(v)), pText(entry.test.p), pText(entry.test.adjusted),
			]));
		});
	}
	say('');
	say(`A difference needs ${CONTRAST_DAYS}+ days in each format ("-" otherwise; with fewer, its test rarely finds even a large one, or runs too narrow).`);
	say('Differences of paired results flip each day\'s sign within its format: a shuffle of the days between the formats would take a format');
	say('whose days differ at all more often for a difference.');
	say('Not split: the near-top lifts, since the app fits one pair of lifts for both formats and a format difference in');
	say('correlation shows in the lifts and backtests here; the other backtests; the secondary slot and book tests.');
}

if (options.out) {
	const outDir = expand(options.out);
	mkdirSync(outDir, { recursive: true });
	const plainWindows = windows.map((window) => ({
		...window,
		rows: window.rows.map((row) => ({ ...row })),
		books: Object.fromEntries(Object.entries(window.books).map(([key, book]) => [key, { top: book.top }])),
	}));
	writeFileSync(join(outDir, 'windows.json'), `${JSON.stringify(plainWindows)}\n`);
	writeFileSync(join(outDir, 'results.json'), `${JSON.stringify({ manifest, coverage, rebuild: { ok: rebuildOk, differ: rebuildDiffer, error: appLiftsError }, results, correlationPrimary, slotPrimary }, null, '\t')}\n`);
	writeFileSync(join(outDir, 'lifts.json'), `${JSON.stringify(fitted, null, 4)}\n`);
	say('');
	say(`Saved the rebuilt windows, the results and this archive's lifts to ${shortPath(outDir)}`);
}

console.log(out.join('\n'));
await cleanup();
