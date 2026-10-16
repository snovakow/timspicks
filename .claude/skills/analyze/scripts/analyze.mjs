#!/usr/bin/env node
// Archive analysis for the analyze skill. It rebuilds every archived pick window the way the app's archive
// replays build them (runSimulation and runHistoricalStrategyAudit in src/picksOptimizer.ts), proves the
// rebuild by deriving the correlation table from it and matching runSimulation's own, then tests three
// questions on actual results: whether picks from one game score together beyond their odds and whether the
// correlation table improves picks, whether one time slot gives better picks, and whether one book or the
// average of the books picks better. Each answer is then measured within the regular season and within the
// playoffs, and the two are compared.
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
const PERMUTATIONS = 20000; // book-label shuffles for the any-book tests
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
// Whether any of k paired series differs: shuffle the k labels within each day, the same shuffle for all
// of that day's windows, and compare the spread of the k means
const anyDifferenceP = (label, daySums, windows) => {
	const k = daySums[0]?.length ?? 0;
	if (k < 2 || !windows) return 1;
	const spread = (means) => {
		const mid = total(means) / k;
		return total(means, (value) => (value - mid) ** 2);
	};
	const means = new Array(k).fill(0);
	for (const sums of daySums) for (let book = 0; book < k; book += 1) means[book] += sums[book] / windows;
	const observed = spread(means) * (1 - 1e-9);
	const random = rngFor(label);
	const order = [...Array(k).keys()];
	let hits = 0;
	for (let draw = 0; draw < PERMUTATIONS; draw += 1) {
		means.fill(0);
		for (const sums of daySums) {
			for (let index = k - 1; index > 0; index -= 1) {
				const swap = Math.floor(random() * (index + 1));
				[order[index], order[swap]] = [order[swap], order[index]];
			}
			for (let book = 0; book < k; book += 1) means[book] += sums[order[book]] / windows;
		}
		if (spread(means) >= observed) hits += 1;
	}
	return (hits + 1) / (PERMUTATIONS + 1);
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
// Exact distribution of a sum of independent items, each a list of [step, probability] on an integer grid
const sumDistribution = (items) => {
	let dist = new Float64Array([1]);
	for (const item of items) {
		const reach = Math.max(...item.map(([step]) => step));
		const next = new Float64Array(dist.length + reach);
		for (let value = 0; value < dist.length; value += 1) {
			if (!dist[value]) continue;
			for (const [step, probability] of item) next[value + step] += dist[value] * probability;
		}
		dist = next;
	}
	return dist;
};
const exactP = (dist, observed) => {
	let atLeast = 0;
	let atMost = 0;
	for (let value = 0; value < dist.length; value += 1) {
		if (value >= observed - 1e-6) atLeast += dist[value];
		if (value <= observed + 1e-6) atMost += dist[value];
	}
	return Math.min(1, 2 * Math.min(atLeast, atMost));
};
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

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
// App.tsx's starting Books setting, and the band its table simulation runs with
const minSportsbooks = setting(/\[\s*minSportsbooks\s*,\s*setMinSportsbooks\s*\]\s*=\s*useState\(\s*(\d+)\s*\)/, appSource, 3, 'the default number of books');
const correlationPercent = setting(/correlationPercent\s*=\s*([\d.]+)/, appSource, 0.999, 'the near-tie band');
const cutoffs = [...optimizerSource.matchAll(/oldestDate\s*=\s*new Date\(\s*["'](\d{4}-\d{2}-\d{2})["']\s*\)/g)].map((match) => match[1]);
const oldestDay = cutoffs.at(-1) ?? null;
if (!cutoffs.length) notes.push("Couldn't read the archive's earliest date from src/picksOptimizer.ts, so every archived day was read");
else if (new Set(cutoffs).size > 1) notes.push(`src/picksOptimizer.ts holds different earliest dates (${[...new Set(cutoffs)].join(', ')}); the table's, ${oldestDay}, was used`);

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
		applyCorrelation: optimizer.applyCorrelation, runSimulation: optimizer.runSimulation,
		getStrategy: selection.getStrategy, ComboGroup: selection.ComboGroup,
		oddsNameCandidates: processor.oddsNameCandidates, removeAccentsNormalize: processor.removeAccentsNormalize, deVig: processor.deVig,
		AllCombos: types.AllCombos, SportsbookKeys: types.SportsbookKeys, LogStatsKeys: types.LogStatsKeys,
		AllStrategies: types.AllStrategies, StrategyLabels: types.StrategyLabels, strategyTitle: types.strategyTitle, Sportsbooks: types.Sportsbooks,
		normalizeSportsbooks: features.normalizeSportsbooks, shippedTable: shipped.correlations,
	};
	const missing = Object.entries(app).filter(([name, value]) => value === undefined && name !== 'normalizeSportsbooks').map(([name]) => name);
	if (missing.length) throw new Error(`src/ no longer exports ${missing.join(', ')}`);
} catch (error) {
	console.error(`The app's code didn't load from src/, so nothing was analyzed: ${clip(String(error?.message ?? error))}`);
	await cleanup();
	process.exit(1);
}
const { calcAny, calcPnt, calcHit, applyCorrelation, getStrategy, ComboGroup, oddsNameCandidates, removeAccentsNormalize } = app;
const BOOKS = [...app.SportsbookKeys];
const KEYS = [...app.LogStatsKeys];
const SHAPES = [...app.AllCombos];
const STRATEGIES = [...app.AllStrategies];
// The challenge's points by number of correct picks, as calcPnt scores them
const POINTS = [0, calcPnt(1, 0, 0), calcPnt(1, 1, 0), calcPnt(1, 1, 1)];
const keyName = (key) => (key === 'betAvg' ? 'Avg' : key);
const strategyName = (strategy) => app.StrategyLabels?.[strategy] ?? strategy;
const shapeName = (shape) => `${shape} (${app.strategyTitle(shape)})`;
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
// A ticket's result, averaged over the tickets tied with it, as ResultTotal keeps it
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
const NONE = { least1: 0, points: 0, hits: 0, count: 0 };
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
		for (const key of KEYS) {
			const top = new ComboGroup();
			const groups = new Map(SHAPES.map((shape) => [shape, new ComboGroup()]));
			for (const pick1 of sets[0]) {
				for (const pick2 of sets[1]) {
					for (const pick3 of sets[2]) {
						const prob1 = pick1[key];
						const prob2 = pick2[key];
						const prob3 = pick3[key];
						if (prob1 === null || prob2 === null || prob3 === null) continue;
						const candidate = { pick1, pick2, pick3, prob1, prob2, prob3, strategy: getStrategy(pick1, pick2, pick3) };
						top.add(candidate);
						groups.get(candidate.strategy)?.add(candidate);
					}
				}
			}
			if (!top.combos.length) continue;
			const baseline = scoreOf(top);
			const book = {
				top: { probs: [top.prob1, top.prob2, top.prob3], pred: baseline, real: outcome(top.combos), ticket: ticketOf(top.combos), combos: idsOf(top.combos) },
				shapes: {},
				totals: { baseline: outcome(top.combos) },
			};
			for (const shape of SHAPES) {
				const group = groups.get(shape);
				if (!group.combos.length) {
					book.totals[shape] = NONE;
					continue;
				}
				const pred = scoreOf(group);
				// The table's near-tie band: a shape counts when its best ticket is within the band of the best ticket on any strategy
				const included = STRATEGIES.some((strategy) => baseline[strategy] > 0 && pred[strategy] >= baseline[strategy] * correlationPercent);
				const real = outcome(group.combos);
				book.shapes[shape] = { probs: [group.prob1, group.prob2, group.prob3], pred, real, included, combos: idsOf(group.combos) };
				book.totals[shape] = included ? real : NONE;
			}
			window.books[key] = book;
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

// --- The correlation table from the rebuild, by the Correlation class's arithmetic --------------

const emptySums = () => ({
	least1: Object.fromEntries(SHAPES.map((shape) => [shape, null])),
	points: Object.fromEntries(SHAPES.map((shape) => [shape, null])),
	hits: Object.fromEntries(SHAPES.map((shape) => [shape, null])),
	count: Object.fromEntries(SHAPES.map((shape) => [shape, 0])),
	baseline: { least1: 0, points: 0, hits: 0, count: 0 },
});
const addTotals = (sums, totals) => {
	for (const shape of SHAPES) {
		const result = totals[shape];
		if (result.count === 0) continue;
		for (const strategy of STRATEGIES) {
			if (sums[strategy][shape] === null) sums[strategy][shape] = 0;
			sums[strategy][shape] += result[strategy];
		}
		sums.count[shape] += result.count;
	}
	for (const strategy of STRATEGIES) sums.baseline[strategy] += totals.baseline[strategy];
	sums.baseline.count += totals.baseline.count;
};
const factorsOf = (sums) => {
	const result = { least1: { ...sums.least1 }, points: { ...sums.points }, hits: { ...sums.hits } };
	const baseline = { ...sums.baseline };
	if (baseline.count === 0) return result;
	for (const strategy of STRATEGIES) baseline[strategy] /= baseline.count;
	for (const shape of SHAPES) {
		const count = sums.count[shape];
		if (count === 0) continue;
		for (const strategy of STRATEGIES) result[strategy][shape] = (sums[strategy][shape] ?? 0) / (count * baseline[strategy]);
	}
	return result;
};
// As pasted into src/correlationData.ts: through JSON, where an empty or undefined factor is null
const tableFrom = (items) => {
	const result = Object.fromEntries([...BUCKETS, 'all'].map((bucket) => [bucket, {}]));
	for (const key of KEYS) {
		const sums = Object.fromEntries([...BUCKETS, 'all'].map((bucket) => [bucket, emptySums()]));
		for (const item of items) {
			const book = item.books[key];
			if (!book) continue;
			addTotals(sums[item.bucket], book.totals);
			addTotals(sums.all, book.totals);
		}
		for (const bucket of [...BUCKETS, 'all']) result[bucket][key] = factorsOf(sums[bucket]);
	}
	return JSON.parse(JSON.stringify(result));
};
const compareTables = (a, b) => {
	let cells = 0;
	let same = 0;
	const differ = [];
	for (const bucket of [...BUCKETS, 'all']) {
		for (const key of KEYS) {
			for (const strategy of STRATEGIES) {
				for (const shape of SHAPES) {
					cells += 1;
					const x = a?.[bucket]?.[key]?.[strategy]?.[shape] ?? null;
					const y = b?.[bucket]?.[key]?.[strategy]?.[shape] ?? null;
					if (x === y) same += 1;
					else differ.push(`${bucket}/${key}/${strategy}/${shape} ${x === null ? 'empty' : x.toFixed(4)} vs ${y === null ? 'empty' : y.toFixed(4)}`);
				}
			}
		}
	}
	return { cells, same, differ };
};
const fullTable = tableFrom(windows);
let appTable = null;
let appTableError = null;
{
	const saved = [console.log, console.info, console.warn, console.error];
	console.log = console.info = console.warn = console.error = () => {};
	try {
		appTable = JSON.parse(JSON.stringify(await app.runSimulation(minSportsbooks, correlationPercent)));
	} catch (error) {
		appTableError = clip(String(error?.message ?? error), 200);
	} finally {
		[console.log, console.info, console.warn, console.error] = saved;
	}
}
const rebuild = appTable ? compareTables(fullTable, appTable) : null;
const rebuildOk = !!rebuild && rebuild.same === rebuild.cells;
const shippedMatch = compareTables(fullTable, JSON.parse(JSON.stringify(app.shippedTable ?? null)));

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
const pairLift = (pick, kind) => {
	let upper = 0;
	let lower = 0;
	for (const index of pick) {
		const cell = pairDays[index][kind];
		const control = pairDays[index].diff;
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
	const draws = bootstrap(`pairs-${kind}`, days.length, (pick) => pairLift(pick, kind));
	Object.assign(pairs[kind], { lift: pairLift(everyDay, kind), interval: interval(draws), p: bootstrapP(draws, 1) });
}
results.pairs = pairs;

// 1b. Each factor the app would apply (above 1), tested against its own shape's odds: under no correlation,
// the shape's tickets on the windows it was counted in score as their picks' calibrated odds say
const factorTests = [];
for (const bucket of BUCKETS) {
	for (const key of KEYS) {
		const items = windows.filter((window) => window.bucket === bucket && window.books[key]);
		if (!items.length) continue;
		// The books' margin, measured on this bucket's top tickets: actual correct picks over odds-implied ones
		const calibration = total(items, (window) => window.books[key].top.real.hits) / total(items, (window) => total(window.books[key].top.probs));
		for (const strategy of STRATEGIES) {
			for (const shape of SHAPES) {
				const factor = fullTable[bucket][key][strategy][shape];
				if (factor === null || !(factor > 1)) continue;
				const counted = items.filter((window) => window.books[key].shapes[shape]?.included);
				const steps = strategy === 'least1' ? [0, 1, 1, 1] : strategy === 'hits' ? [0, 1, 2, 3] : null;
				const grid = steps ?? (() => {
					const cents = POINTS.map((value) => Math.round(value * 100));
					const unit = cents.slice(1).reduce(gcd);
					return cents.map((value) => value / unit);
				})();
				const unit = strategy === 'points' ? POINTS[3] / grid[3] : 1;
				const dists = counted.map((window) => {
					const q = window.books[key].shapes[shape].probs.map((p) => Math.min(0.999, calibration * p));
					const byHits = [1, 0, 0, 0];
					for (const chance of q) {
						for (let k = 3; k >= 0; k -= 1) byHits[k] = byHits[k] * (1 - chance) + (k ? byHits[k - 1] * chance : 0);
					}
					const merged = new Map();
					byHits.forEach((probability, k) => merged.set(grid[k], (merged.get(grid[k]) ?? 0) + probability));
					return [...merged];
				});
				const dist = sumDistribution(dists);
				const observed = total(counted, (window) => window.books[key].shapes[shape].real[strategy]);
				let expected = 0;
				dist.forEach((probability, value) => { expected += probability * value; });
				factorTests.push({
					bucket, key, strategy, shape, factor, windows: counted.length, days: new Set(counted.map((window) => window.day)).size,
					observed, expected: expected * unit, p: exactP(dist, observed / unit),
				});
			}
		}
	}
}
holm(factorTests.map((test) => test.p)).forEach((adjusted, index) => { factorTests[index].adjusted = adjusted; });
results.factorTests = factorTests;

// 1c. Backtest: the app's highlighted pick for each book and strategy, with correlation off and on. "Held
// out" fits the table without the day being tested, so a day never votes for its own picks
const choose = (book, strategy, factors) => {
	let max = 0;
	const values = [];
	for (const shape of SHAPES) {
		const entry = book.shapes[shape];
		if (!entry) continue;
		const value = applyCorrelation(strategy, entry.pred[strategy], factors ? (factors[shape] ?? null) : null);
		values.push([shape, value]);
		if (value > max) max = value;
	}
	const winners = values.filter(([, value]) => value === max).map(([shape]) => shape);
	if (!winners.length) return null;
	const real = { least1: 0, points: 0, hits: 0 };
	for (const shape of winners) for (const measure of STRATEGIES) real[measure] += book.shapes[shape].real[measure] / winners.length;
	return { winners: winners.join(','), real };
};
const heldOutTables = new Map(days.map((day) => [day, tableFrom(windows.filter((window) => window.day !== day))]));
const backtest = {};
// Each backtest's per-day differences, held out minus off, for the format comparison
const backtestDays = new Map();
for (const key of KEYS) {
	backtest[key] = {};
	for (const strategy of STRATEGIES) {
		const perDay = new Map();
		const sums = { off: 0, inSample: 0, heldOut: 0, windows: 0, changed: 0 };
		for (const window of windows) {
			const book = window.books[key];
			if (!book) continue;
			const off = choose(book, strategy, null);
			const inSample = choose(book, strategy, fullTable[window.bucket][key][strategy]);
			const heldOut = choose(book, strategy, heldOutTables.get(window.day)[window.bucket][key][strategy]);
			if (!off || !inSample || !heldOut) continue;
			sums.windows += 1;
			sums.off += off.real[strategy];
			sums.inSample += inSample.real[strategy];
			sums.heldOut += heldOut.real[strategy];
			if (heldOut.winners !== off.winners) sums.changed += 1;
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

// 1d. Settling: the table regenerated after each archive day, with today's code. Every factor is an average,
// and averages steady as their samples grow whether there's an effect or not, so steadying alone proves
// nothing. The question is whether more factors settle above 1 than chance leaves there. Chance keeps the
// same windows and picks, and each day's real results, shuffled among players of about the same price:
// that keeps how much was scored each day and at each price, and breaks any link between players of one game
const SIMULATIONS = 200;
const STRATUM = 4; // players per price band in a shuffle
const CELLS = [];
for (const bucket of BUCKETS) for (const key of KEYS) for (const strategy of STRATEGIES) for (const shape of SHAPES) CELLS.push({ bucket, key, strategy, shape });
const GROUPS = BUCKETS.length * KEYS.length;
const PER_GROUP = STRATEGIES.length * SHAPES.length;
const groupOf = (bucket, key) => BUCKETS.indexOf(bucket) * KEYS.length + KEYS.indexOf(key);
const windowsOfDay = days.map(() => []);
for (const window of windows) windowsOfDay[dayIndex.get(window.day)].push(window);
// Each factor after each day (NaN while empty), with the windows each slot and book had counted by then
const trajectory = (resultOf) => {
	const values = new Float64Array(days.length * CELLS.length).fill(NaN);
	const counts = new Float64Array(days.length * GROUPS);
	const sums = Array.from({ length: GROUPS }, () => ({ shape: new Float64Array(PER_GROUP), count: new Float64Array(SHAPES.length), base: new Float64Array(STRATEGIES.length), baseCount: 0 }));
	for (let day = 0; day < days.length; day += 1) {
		for (const window of windowsOfDay[day]) {
			for (const key of KEYS) {
				const book = window.books[key];
				if (!book) continue;
				const group = sums[groupOf(window.bucket, key)];
				const base = resultOf(window, key, null);
				STRATEGIES.forEach((strategy, s) => { group.base[s] += base[strategy]; });
				group.baseCount += base.count;
				SHAPES.forEach((shape, h) => {
					if (!book.shapes[shape]?.included) return;
					const result = resultOf(window, key, shape);
					STRATEGIES.forEach((strategy, s) => { group.shape[s * SHAPES.length + h] += result[strategy]; });
					group.count[h] += result.count;
				});
			}
		}
		for (let g = 0; g < GROUPS; g += 1) {
			const group = sums[g];
			counts[day * GROUPS + g] = group.baseCount;
			if (!group.baseCount) continue;
			for (let s = 0; s < STRATEGIES.length; s += 1) {
				const baseline = group.base[s] / group.baseCount;
				for (let h = 0; h < SHAPES.length; h += 1) {
					const count = group.count[h];
					const value = count ? group.shape[s * SHAPES.length + h] / (count * baseline) : NaN;
					values[day * CELLS.length + g * PER_GROUP + s * SHAPES.length + h] = Number.isFinite(value) ? value : NaN;
				}
			}
		}
	}
	return { values, counts };
};
// Above 1 at the end, and settled there: above 1 at every step that added to its slot's last quarter of windows
const settledCounts = ({ values, counts }) => {
	const last = days.length - 1;
	let above = 0;
	let settled = 0;
	for (let cell = 0; cell < CELLS.length; cell += 1) {
		if (!(values[last * CELLS.length + cell] > 1)) continue;
		above += 1;
		const group = Math.floor(cell / PER_GROUP);
		const final = counts[last * GROUPS + group];
		let steady = true;
		for (let day = 0; day <= last && steady; day += 1) {
			const count = counts[day * GROUPS + group];
			const before = day ? counts[(day - 1) * GROUPS + group] : 0;
			if (count === before || count < 0.75 * final) continue;
			if (!(values[day * CELLS.length + cell] > 1)) steady = false;
		}
		if (steady) settled += 1;
	}
	return { above, settled };
};
const observedPath = trajectory((window, key, shape) => (shape ? window.books[key].totals[shape] : window.books[key].totals.baseline));
const lastRow = (days.length - 1) * CELLS.length;
const pathMatches = CELLS.every((cell, index) => {
	const value = fullTable[cell.bucket][cell.key][cell.strategy][cell.shape];
	const traced = observedPath.values[lastRow + index];
	return value === null ? Number.isNaN(traced) : traced === value;
});
if (!pathMatches) notes.push("The day-by-day tables don't end at this archive's table, so the settling numbers are suspect");
// Checkpoints: the last archive day of each month
const checkpoints = days.map((day, index) => ({ day, index })).filter(({ day, index }) => index === days.length - 1 || days[index + 1].slice(0, 7) !== day.slice(0, 7));
const settlingRows = checkpoints.map(({ day, index }, position) => {
	const at = (cell, row) => observedPath.values[row * CELLS.length + cell];
	const previous = position ? checkpoints[position - 1].index : null;
	let above = 0;
	let kept = 0;
	let crossed = 0;
	const moves = [];
	for (let cell = 0; cell < CELLS.length; cell += 1) {
		const value = at(cell, index);
		if (value > 1) {
			above += 1;
			if (at(cell, days.length - 1) > 1) kept += 1;
		}
		if (previous === null) continue;
		const before = at(cell, previous);
		if (Number.isNaN(value) || Number.isNaN(before)) continue;
		if ((value > 1) !== (before > 1)) crossed += 1;
		if (value !== before) moves.push(Math.abs(value - before));
	}
	return {
		day, windows: total(windowsOfDay.slice(0, index + 1), (list) => list.length), above, kept,
		crossed: previous === null ? null : crossed, moved: previous === null ? null : moves.length, move: moves.length ? quantile(moves.sort((a, b) => a - b), 0.5) : NaN,
	};
});
// Chance: within each day, players in order of their Avg price, in bands of STRATUM; each run shuffles the results within every band
const playerSlot = new Map(playerDays.map((row, index) => [`${row.day}|${row.id}`, index]));
const bands = [];
for (const list of groupBy(playerDays.map((row, index) => ({ row, index })), ({ row }) => row.dayIndex).values()) {
	list.sort((a, b) => b.row.betAvg - a.row.betAvg);
	for (let start = 0; start < list.length; start += STRATUM) bands.push(list.slice(start, start + STRATUM).map(({ index }) => index));
}
const actual = Uint8Array.from(playerDays, (row) => (row.scored ? 1 : 0));
const indexed = new Map();
for (const window of windows) {
	for (const key of KEYS) {
		const book = window.books[key];
		if (!book) continue;
		const toIndex = (combos) => combos.map((combo) => combo.map((id) => playerSlot.get(`${window.day}|${id}`)));
		indexed.set(book, { top: toIndex(book.top.combos), shapes: Object.fromEntries(SHAPES.filter((shape) => book.shapes[shape]?.included).map((shape) => [shape, toIndex(book.shapes[shape].combos)])) });
	}
}
const simulated = new Uint8Array(playerDays.length);
const simulatedResult = (combos) => {
	let least1 = 0;
	let points = 0;
	let hits = 0;
	for (const [a, b, c] of combos) {
		const hitCount = simulated[a] + simulated[b] + simulated[c];
		if (hitCount > 0) least1 += 1;
		points += POINTS[hitCount];
		hits += hitCount;
	}
	const count = combos.length;
	return count > 1 ? { least1: least1 / count, points: points / count, hits: hits / count, count: 1 } : { least1, points, hits, count };
};
const observedSettling = settledCounts(observedPath);
const chanceSettling = { above: [], settled: [] };
{
	const random = rngFor('settling');
	for (let run = 0; run < SIMULATIONS; run += 1) {
		for (const band of bands) {
			const results = band.map((index) => actual[index]);
			for (let index = results.length - 1; index > 0; index -= 1) {
				const swap = Math.floor(random() * (index + 1));
				[results[index], results[swap]] = [results[swap], results[index]];
			}
			band.forEach((index, position) => { simulated[index] = results[position]; });
		}
		const counts = settledCounts(trajectory((window, key, shape) => {
			const combos = indexed.get(window.books[key]);
			return simulatedResult(shape ? combos.shapes[shape] : combos.top);
		}));
		chanceSettling.above.push(counts.above);
		chanceSettling.settled.push(counts.settled);
	}
}
const settling = {};
for (const measure of ['above', 'settled']) {
	const draws = [...chanceSettling[measure]].sort((a, b) => a - b);
	settling[measure] = {
		observed: observedSettling[measure], median: Math.round(quantile(draws, 0.5)), range: [quantile(draws, 0.05), quantile(draws, 0.95)].map(Math.round),
		p: (1 + draws.filter((value) => value >= observedSettling[measure]).length) / (1 + draws.length),
	};
}
results.settling = { checkpoints: settlingRows, settling, simulations: SIMULATIONS };

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

// --- 3. Sportsbooks: each book's top ticket, and the Avg's ---------------------------------------

// Only windows where all five have a ticket, so every book is measured on the same windows
const allFive = windows.filter((window) => KEYS.every((key) => window.books[key]));
const allFiveByDay = groupBy(allFive, (window) => window.day);
const bookRows = KEYS.map((key) => {
	const list = allFive.map((window) => metric(window, key));
	const differs = allFive.filter((window) => window.books[key].top.ticket !== window.books.betAvg.top.ticket);
	const values = allFive.map((window) => ({ day: dayIndex.get(window.day), value: metric(window, key).streak }));
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
const anyBook = {};
for (const measure of ['streak', 'picks']) {
	const daySums = [...allFiveByDay.values()].map((list) => KEYS.map((key) => total(list, (window) => metric(window, key)[measure])));
	anyBook[measure] = anyDifferenceP(`any-book-${measure}`, daySums, allFive.length);
}
holm([anyBook.streak, anyBook.picks]).forEach((adjusted, index) => { anyBook[index ? 'picksAdjusted' : 'streakAdjusted'] = adjusted; });
const versusAvg = {};
for (const measure of ['streak', 'picks']) {
	versusAvg[measure] = BOOKS.map((key) => ({
		key,
		test: pairedTest(`versus-avg-${measure}-${key}`, [...allFiveByDay.values()].map((list) => ({
			sum: total(list, (window) => metric(window, key)[measure] - metric(window)[measure]), count: list.length,
		}))),
	}));
	holm(versusAvg[measure].map((entry) => entry.test.p)).forEach((adjusted, index) => { versusAvg[measure][index].test.adjusted = adjusted; });
}

// Player level: how well each book's prices sort scorers from non-scorers, on players all four books priced
const fourBooks = playerDays.filter((row) => BOOKS.every((book) => row[book] !== null));
const aucOf = (rows, score) => {
	const sorted = rows.map((row) => ({ score: score(row), positive: row.scored, day: row.dayIndex })).sort((a, b) => a.score - b.score);
	return (weights) => {
		let below = 0;
		let sum = 0;
		let positives = 0;
		let negatives = 0;
		for (let index = 0; index < sorted.length;) {
			let end = index;
			let groupPositive = 0;
			let groupNegative = 0;
			while (end < sorted.length && sorted[end].score === sorted[index].score) {
				const weight = weights ? weights[sorted[end].day] : 1;
				if (sorted[end].positive) groupPositive += weight;
				else groupNegative += weight;
				end += 1;
			}
			sum += groupPositive * (below + groupNegative / 2);
			below += groupNegative;
			positives += groupPositive;
			negatives += groupNegative;
			index = end;
		}
		return sum / (positives * negatives);
	};
};
const aucs = Object.fromEntries(KEYS.map((key) => [key, aucOf(fourBooks, (row) => row[key])]));
const playerRows = KEYS.map((key) => {
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

// Each book against the Avg on per-day sums of one measure; read only where the any-book test for the same windows is significant
const versusAvgOn = (label, byDay, measure) => {
	const versus = BOOKS.map((key) => ({
		key,
		test: pairedTest(`${label}-${key}`, byDay.map((list) => ({ sum: total(list, (window) => measure(window, key) - measure(window, 'betAvg')), count: list.length }))),
	}));
	holm(versus.map((entry) => entry.test.p)).forEach((adjusted, index) => { versus[index].test.adjusted = adjusted; });
	return versus;
};

// Per slot: the first window of each slot per day, the windows the audit reads when it weights the books for that slot
const perSlotBooks = BUCKETS.map((bucket) => {
	const list = [...firstOfBucket.values()].map((firsts) => firsts.get(bucket)).filter((window) => window && KEYS.every((key) => window.books[key]));
	const rates = Object.fromEntries(KEYS.map((key) => [key, average(list, (window) => metric(window, key).streak)]));
	const p = list.length ? anyDifferenceP(`slot-books-${bucket}`, list.map((window) => KEYS.map((key) => metric(window, key).streak)), list.length) : NaN;
	const versus = versusAvgOn(`slot-versus-${bucket}`, list.map((window) => [window]), (window, key) => metric(window, key).streak);
	return { bucket, days: list.length, rates, p, versus };
});
holm(perSlotBooks.map((row) => row.p)).forEach((adjusted, index) => { perSlotBooks[index].adjusted = adjusted; });

// Per pick pool: how often each book's top player in each list scored. The lists are independent, so a book's
// top ticket is its top player in every list, and a tie spreads the ticket evenly over the tied players
const scoredIn = new WeakMap();
const scoredOf = (window, id) => {
	if (!scoredIn.has(window)) scoredIn.set(window, new Map(window.rows.map((row) => [row.id, row.scored ? 1 : 0])));
	return scoredIn.get(window).get(id) ?? 0;
};
const poolHit = (window, key, list) => average(window.books[key].top.combos, (combo) => scoredOf(window, combo[list]));
const allFiveDays = [...allFiveByDay.values()];
const perPoolBooks = LISTS.map((sid, list) => ({
	sid,
	rates: Object.fromEntries(KEYS.map((key) => [key, average(allFive, (window) => poolHit(window, key, list))])),
	p: anyDifferenceP(`pool-books-${sid}`, allFiveDays.map((day) => KEYS.map((key) => total(day, (window) => poolHit(window, key, list)))), allFive.length),
	versus: versusAvgOn(`pool-versus-${sid}`, allFiveDays, (window, key) => poolHit(window, key, list)),
}));
holm(perPoolBooks.map((row) => row.p)).forEach((adjusted, index) => { perPoolBooks[index].adjusted = adjusted; });
results.books = { rows: bookRows, anyBook, versusAvg, players: playerRows, fourBooks: fourBooks.length, perSlot: perSlotBooks, perPool: perPoolBooks };

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
// With fewer days in a format, the shuffle below finds differences that aren't there more often than it should
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
// Whether paired differences change between the formats: the format labels are shuffled among the days. Most days
// differ by a whole result or not at all, which resampling can't test with few days, so the test is a shuffle.
// Each component's gap between the formats is studentized, since the formats' days vary by different amounts;
// with several components (each book against the Avg), the largest is the statistic. Units: { f, sums, count }
const formatShuffleP = (label, units, components) => {
	const statistic = (labels) => {
		let largest = 0;
		for (let component = 0; component < components; component += 1) {
			const parts = [0, 1].map((f) => {
				let sum = 0;
				let count = 0;
				let size = 0;
				units.forEach((unit, index) => {
					if (labels[index] !== f) return;
					sum += unit.sums[component];
					count += unit.count;
					size += 1;
				});
				const mean = sum / count;
				let squares = 0;
				units.forEach((unit, index) => { if (labels[index] === f) squares += (unit.sums[component] - mean * unit.count) ** 2; });
				return { mean, variance: (size / (size - 1)) * squares / count ** 2 };
			});
			const gap = Math.abs(parts[0].mean - parts[1].mean);
			const error = Math.sqrt(parts[0].variance + parts[1].variance);
			const t = gap < 1e-12 ? 0 : error > 0 ? gap / error : Infinity;
			if (t > largest) largest = t;
		}
		return largest;
	};
	const labels = units.map((unit) => unit.f);
	const observed = statistic(labels) * (1 - 1e-9);
	const random = rngFor(label);
	let hits = 0;
	for (let draw = 0; draw < PERMUTATIONS; draw += 1) {
		for (let index = labels.length - 1; index > 0; index -= 1) {
			const swap = Math.floor(random() * (index + 1));
			[labels[index], labels[swap]] = [labels[swap], labels[index]];
		}
		if (statistic(labels) >= observed) hits += 1;
	}
	return (hits + 1) / (PERMUTATIONS + 1);
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
				? formatShuffleP(`format-shuffle-${label}`, parts.flatMap((part, f) => part.map((unit) => ({ f, sums: [unit.sum], count: unit.count }))), 1)
				: NaN,
		},
	};
};
// A pair lift within each format; the contrast is the ratio of the two lifts
const formatLift = (kind) => {
	const estimates = formatDays.map((list) => pairLift(list, kind));
	const { each, contrasts } = bootstrapFormats(`format-pairs-${kind}`, formatDays.map((list) => list.length), (f, pick) => pairLift(pick.map((index) => formatDays[f][index]), kind), (a, b) => a / b);
	return {
		days: formatDays.map((list) => list.length),
		formats: estimates.map((estimate, f) => ({ estimate, ...bounds(each[f]), p: bootstrapP(each[f], 1) })),
		contrast: { estimate: estimates[0] / estimates[1], ...bounds(contrasts), p: comparable(formatDays.map((list) => list.length)) ? bootstrapP(contrasts, 1) : NaN },
	};
};
// A book's AUC minus the Avg's, within each format's player-days
const formatAucs = FORMATS.map((format) => {
	const rows = fourBooks.filter((row) => dayFormat[row.dayIndex] === format);
	return { rows: rows.length, auc: Object.fromEntries(KEYS.map((key) => [key, aucOf(rows, (row) => row[key])])) };
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
// The any-book test within each format, each book against the Avg there (read only where that format's test is
// significant), and whether any book's gap to the Avg changes between the formats
const formatBooks = (measure) => {
	const parts = FORMATS.map((format) => allFiveDays.filter((list) => list[0].format === format));
	if (parts.some((part) => part.length < 2)) return null;
	const sums = parts.map((part) => part.map((list) => ({ values: KEYS.map((key) => total(list, (window) => metric(window, key)[measure])), count: list.length })));
	const avg = KEYS.indexOf('betAvg');
	const units = sums.flatMap((list, f) => list.map((day) => ({ f, sums: BOOKS.map((book) => day.values[KEYS.indexOf(book)] - day.values[avg]), count: day.count })));
	return {
		days: parts.map((part) => part.length),
		formats: parts.map((part, f) => ({
			rates: KEYS.map((_, book) => total(sums[f], (day) => day.values[book]) / total(sums[f], (day) => day.count)),
			p: anyDifferenceP(`format-books-${measure}-${FORMATS[f]}`, sums[f].map((day) => day.values), total(part, (list) => list.length)),
			versus: versusAvgOn(`format-versus-${measure}-${FORMATS[f]}`, part, (window, key) => metric(window, key)[measure]),
		})),
		contrast: { p: comparable(parts.map((part) => part.length)) ? formatShuffleP(`format-books-${measure}`, units, BOOKS.length) : NaN },
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
		add({ question: 'sportsbooks', primary: true, type: 'books', measure, label: `any book, ${measure === 'streak' ? 'Streak' : 'picks correct'}` }, formatBooks(measure));
	}
	for (const key of BOOKS) add({ question: 'sportsbooks', primary: false, type: 'auc', key, label: `${key}'s AUC vs the Avg's` }, formatAuc(key));
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

const backtestFormat = (strategy) => (strategy === 'points' ? (v) => signed(v, 2, 1, '') : strategy === 'hits' ? (v) => signed(v / 3) : (v) => signed(v));
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
// Secondary: every other book and strategy's backtest, corrected together; and the two settling counts
const otherBacktests = KEYS.flatMap((key) => STRATEGIES.map((strategy) => backtest[key][strategy] && !(key === 'betAvg' && strategy !== 'hits') ? backtest[key][strategy] : null)).filter(Boolean);
holm(otherBacktests.map((result) => result.test.p)).forEach((adjusted, index) => { otherBacktests[index].test.adjusted = adjusted; });
holm([settling.above.p, settling.settled.p]).forEach((adjusted, index) => { settling[index ? 'settled' : 'above'].adjusted = adjusted; });
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
const factorSignificant = factorTests.filter((test) => test.adjusted < ALPHA);
const factorSmallest = [...factorTests].sort((a, b) => a.p - b.p);
const bookHits = [];
for (const measure of ['streak', 'picks']) {
	if (anyBook[`${measure}Adjusted`] >= ALPHA) continue;
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
	for (const strategy of STRATEGIES) {
		const result = backtest[key][strategy];
		if (!result) continue;
		const avg = key === 'betAvg';
		consider({
			primary: avg && strategy !== 'hits', question: 'correlation', p: result.test.p, adjusted: result.test.adjusted, text: backtestText(key, strategy, result),
			favors: !avg ? 'none' : result.test.estimate > 0 ? 'other' : 'avg',
			short: backtestShort(strategy, result.test.estimate),
		});
	}
}
for (const test of factorTests) {
	consider({
		primary: false, question: 'correlation', p: test.p, adjusted: test.adjusted, favors: 'none',
		text: `factor ${test.factor.toFixed(2)} for ${bucketName(test.bucket)}, ${keyName(test.key)}, ${strategyName(test.strategy)}, ${shapeName(test.shape)} (${test.windows} windows)`,
	});
}
for (const [measure, label] of [['above', 'above 1 at the end'], ['settled', 'settled above 1']]) {
	consider({
		primary: false, question: 'correlation', p: settling[measure].p, adjusted: settling[measure].adjusted, favors: 'none',
		text: `${settling[measure].observed} factors ${label}, where chance leaves ${settling[measure].median}`,
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
	const adjusted = anyBook[`${measure}Adjusted`];
	consider({ primary: true, question: 'sportsbooks', p: anyBook[measure], adjusted, favors: 'none', text: `the five tickets' ${label} rates differ (any-book test)` });
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
		consider({ primary: false, question: 'sportsbooks', p: row.p, adjusted: row.adjusted, favors: 'none', text: `books differ in ${name(row)} (any-book test)` });
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
	? `${test.label}: the books' gaps differ between the regular season and the playoffs`
	: `${test.label}: ${formatCell(test, test.formats[0])} in the regular season, ${formatCell(test, test.formats[1])} in the playoffs (${test.type === 'lift' ? 'ratio' : 'difference'} ${formatCell(test, test.contrast)})`);
for (const test of formatTests) {
	const differs = test.contrast.adjusted < ALPHA;
	consider({
		primary: test.primary, question: FORMAT_QUESTION, p: test.contrast.p, adjusted: test.contrast.adjusted, favors: 'none', text: formatContrastText(test),
		short: test.type === 'books'
			? `the books' gaps on ${test.measure === 'streak' ? 'Streak' : 'picks correct'}`
			: `${test.label} (${formatValue(test, test.formats[0].estimate)} in the regular season, ${formatValue(test, test.formats[1].estimate)} in the playoffs)`,
	});
	test.formats.forEach((part, f) => {
		const format = FORMATS[f];
		const primary = test.primary && differs;
		const where = `in ${formatName(format)}, `;
		if (test.type === 'books') {
			const label = test.measure === 'streak' ? 'Streak' : 'picks correct';
			consider({ primary, question: 'sportsbooks', format, p: part.p, adjusted: part.adjusted, favors: 'none', text: `${where}the five tickets' ${label} rates differ (any-book test)` });
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
say(`Windows: ${plural(windows.length, 'window')} on ${plural(days.length, 'day')}, ${plural(allFive.length, 'window')} with a ticket from all five`);
const skipped = [
	coverage.missingFiles.length && `${coverage.missingFiles.length} without a list or book file (${coverage.missingFiles.slice(0, SHOW).join(', ')}${coverage.missingFiles.length > SHOW ? ', …' : ''})`,
	coverage.noPlayers.length && `${coverage.noPlayers.length} with no listed player found in that day's history`,
	coverage.emptyList.length && `${coverage.emptyList.length} with a list where no player had ${minSportsbooks}+ books (${coverage.emptyList.slice(0, SHOW).join(', ')})`,
].filter(Boolean);
if (skipped.length) say(`  skipped, as the app's replays skip them: ${skipped.join('; ')}`);
if (coverage.noWindows.length) say(`  history days with no usable window: ${coverage.noWindows.join(', ')}`);
if (coverage.notInHistory) say(`  ${plural(coverage.notInHistory, 'list entry', 'list entries')} missing from that day's history, skipped as the app skips them`);
if (coverage.borrowed.length) say(`  snapshot folders taken from a later folder: ${coverage.borrowed.join(', ')}`);
say(`Books: ${BOOKS.map((book) => `${book} (${app.Sportsbooks?.[book]?.title ?? '?'})`).join(', ')}; Avg is their average for players priced by ${minSportsbooks}+`);
if (rebuildOk) say(`Rebuild check: the rebuilt windows give runSimulation's table exactly (${rebuild.same} of ${rebuild.cells} values), so this analysis sees what the app sees`);
else if (rebuild) say(`Rebuild check: FAILED, ${rebuild.cells - rebuild.same} of ${rebuild.cells} values differ from runSimulation's table (${rebuild.differ.slice(0, 3).join('; ')}). Don't trust the numbers below until this is fixed`);
else say(`Rebuild check: FAILED, runSimulation didn't run (${appTableError}). Don't trust the numbers below until this is fixed`);
say(`src/correlationData.ts: ${shippedMatch.same === shippedMatch.cells ? `matches this archive's table (all ${shippedMatch.cells} values)` : `differs from this archive's table in ${shippedMatch.cells - shippedMatch.same} of ${shippedMatch.cells} values`}`);
say(`Settings: ${minSportsbooks}+ books per player, near-tie band ${correlationPercent}, ${app.normalizeSportsbooks ? 'de-vigged' : 'no de-vig'}, archive from ${oldestDay ?? 'the start'}${options.since || options.until || options.format ? `; options: ${[options.since && `since ${options.since}`, options.until && `until ${options.until}`, options.format].filter(Boolean).join(', ')}` : ''}`);
say(`Tests: two-sided at ${ALPHA} after Holm correction within each question; resampling draws whole days (${options.boot.toLocaleString('en-US')} draws, seed ${options.seed})`);
for (const note of notes) say(`Note: ${note}`);
if (ignored.length) say(`Note: ignored ${ignored.join(' ')}`);

section('Verdicts');
say(`Correlation: ${verdictLine(correlationPrimary)}`);
say(`  Table factors: ${factorTests.length} the app would apply; ${factorSignificant.length ? `SIGNIFICANT after Holm: ${factorSignificant.map((test) => `${test.bucket}/${keyName(test.key)}/${strategyName(test.strategy)}/${test.shape}`).join(', ')}` : `none significant after Holm`}${factorSmallest.length ? ` (smallest p ${pText(factorSmallest[0].p)})` : ''}`);
say(`  Settling: ${settling.settled.observed} factors settled above 1, where chance leaves ${settling.settled.median} (90% of chance runs ${settling.settled.range.join('–')}; p ${pText(settling.settled.p)}, Holm ${pText(settling.settled.adjusted)})${settling.settled.adjusted < ALPHA ? ', MORE THAN CHANCE' : ''}`);
say(`Time slot: ${verdictLine(slotPrimary)}`);
const anyBookText = `any-book test p ${pText(anyBook.streak)} on Streak, ${pText(anyBook.picks)} on picks (Holm ${pText(anyBook.streakAdjusted)}, ${pText(anyBook.picksAdjusted)})`;
say(`Sportsbooks: ${anyBook.streakAdjusted < ALPHA || anyBook.picksAdjusted < ALPHA ? `SIGNIFICANT: ${anyBookText}${bookHits.length ? `; ${bookHits.join('; ')}` : '; no single book differs from Avg after Holm'}` : `no book picks differently from the others: ${anyBookText}`}`);
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
	if (booksWithin.length) say(`  Any-book tests within each format: ${booksWithin.join(', ')}`);
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

sub('The table\'s factors');
const factorWindows = factorTests.map((test) => test.windows).sort((a, b) => a - b);
say(`${factorTests.length} factors above 1 (the ones the app applies) across slots 1–4+, five books and three strategies;`);
say(`median ${quantile(factorWindows, 0.5) || 0} windows each, ${factorWindows.filter((count) => count <= 5).length} on 5 or fewer. Each is tested against its shape's own odds, calibrated to the slot's top tickets.`);
if (factorSmallest.length) {
	table(['smallest p', 'factor', 'windows', 'actual', 'expected', 'p', 'Holm'], factorSmallest.slice(0, SHOW).map((test) => [
		`${bucketName(test.bucket)}, ${keyName(test.key)}, ${strategyName(test.strategy)}, ${shapeName(test.shape)}`, test.factor.toFixed(3), test.windows,
		test.strategy === 'least1' ? `${test.observed.toFixed(1)} hit` : test.strategy === 'hits' ? `${test.observed.toFixed(1)} picks` : `${test.observed.toFixed(0)} pts`,
		test.strategy === 'points' ? `${test.expected.toFixed(0)} pts` : test.expected.toFixed(1), pText(test.p), pText(test.adjusted),
	]));
}

sub('Backtest: the app\'s pick with correlation on vs off');
say('Per book and strategy, every window; "held out" refits the table without the window\'s own day. Difference and test are held out minus off.');
for (const strategy of STRATEGIES) {
	const format = strategy === 'points' ? pts : strategy === 'hits' ? (v) => pct(v / 3) : (v) => pct(v);
	const diffFormat = strategy === 'points' ? (v) => signed(v, 2, 1, '') : strategy === 'hits' ? (v) => signed(v / 3) : (v) => signed(v);
	say('');
	say(`${strategyName(strategy)}${strategy === 'hits' ? ' (share of picks correct; correlation can\'t change the expected number of correct picks, so its factors measure noise)' : strategy === 'points' ? ' (points per window)' : ' (at least one correct)'}`);
	table(['book', 'windows', 'changed', 'off', 'on, in sample', 'on, held out', 'difference', '95% CI', 'p', 'Holm'], KEYS.filter((key) => backtest[key][strategy]).map((key) => {
		const result = backtest[key][strategy];
		return [keyName(key), result.windows, result.changed, format(result.off), format(result.inSample), format(result.heldOut),
			diffFormat(result.test.estimate), span([result.test.low, result.test.high], diffFormat), pText(result.test.p), pText(result.test.adjusted)];
	}));
}
say('');
say('Holm: the Avg\'s Streak and Points rows with the pair tests (primary); every other row together (secondary).');

sub('Do the factors settle? (the table regenerated after each archive day, with today\'s code)');
say('Slots 1–4+, five books, three strategies. Last archive day of each month:');
table(['checkpoint', 'windows', 'above 1', 'still above 1 at the end', 'moved since previous', 'median move', 'crossed 1'], settlingRows.map((row) => [
	row.day, row.windows, row.above, row.kept, row.moved ?? '', Number.isFinite(row.move) ? row.move.toFixed(3) : '', row.crossed ?? '',
]));
say('Factors steady as the archive grows whether or not an effect is real: each is an average, and averages settle.');
say(`What would show an effect is more factors staying above 1 than chance leaves there. Chance: ${SIMULATIONS} runs with the same`);
say(`windows and picks and each day's real results, shuffled among players of about the same price (bands of ${STRATUM}), so no link within a game.`);
table(['', 'actual', 'chance median', 'chance 90% range', 'p'], [
	['above 1 at the end', settling.above.observed, settling.above.median, settling.above.range.join('–'), pText(settling.above.p)],
	['settled above 1*', settling.settled.observed, settling.settled.median, settling.settled.range.join('–'), pText(settling.settled.p)],
]);
say('* above 1 at every step through the last quarter of its slot\'s windows. p: the share of chance runs with at least as many.');

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
say(`Each book's top ticket, from players with ${minSportsbooks}+ books that it prices, on the ${plural(allFive.length, 'window')} where all five have one.`);
table(['book', 'differs from Avg', 'Streak odds', 'Streak actual', '95% CI', 'picks odds', 'picks actual', 'points'], bookRows.map((row) => [
	keyName(row.key), row.key === 'betAvg' ? '' : `${row.differs}${row.differs ? ` (${pct(row.differsStreak, 0)} vs ${pct(row.differsAvgStreak, 0)})` : ''}`,
	pct(row.oddsStreak), pct(row.streak), span(row.interval, (v) => pct(v, 0)), pct(row.oddsPicks), pct(row.picks), pts(row.points),
]));
say('"Differs from Avg": windows where the book\'s ticket isn\'t the Avg\'s, with both tickets\' Streak rate there. Only those windows can separate them.');
say('');
say(`Any book different (labels shuffled within days): Streak p ${pText(anyBook.streak)}, picks p ${pText(anyBook.picks)}; Holm ${pText(anyBook.streakAdjusted)}, ${pText(anyBook.picksAdjusted)}`);
table(['vs Avg', 'Streak diff', '95% CI', 'p', 'Holm', 'picks diff', '95% CI', 'p', 'Holm'], BOOKS.map((key, index) => {
	const streak = versusAvg.streak[index].test;
	const picks = versusAvg.picks[index].test;
	return [key, signed(streak.estimate), span([streak.low, streak.high], (v) => signed(v, 1)), pText(streak.p), pText(streak.adjusted),
		signed(picks.estimate), span([picks.low, picks.high], (v) => signed(v, 1)), pText(picks.p), pText(picks.adjusted)];
}));
say('');
say(`Player level: ${plural(fourBooks.length, 'player-day')} priced by all four books (first window each day); ${pct(scoredRate)} scored. AUC is how often a scorer is priced above a non-scorer.`);
table(['book', 'implied', 'AUC', 'vs Avg', '95% CI', 'p', 'Holm'], playerRows.map((row) => [
	keyName(row.key), pct(row.implied), row.auc.toFixed(4), row.key === 'betAvg' ? '' : signed(row.diff, 4, 1, ''),
	row.key === 'betAvg' ? '' : span(row.interval, (v) => signed(v, 4, 1, '')), row.key === 'betAvg' ? '' : pText(row.p), row.key === 'betAvg' ? '' : pText(row.adjusted),
]));
say('');
const versusRows = (rows, name) => {
	for (const row of rows.filter((entry) => entry.adjusted < ALPHA)) {
		say(`${name(row)}, each book vs the Avg (Holm over the four):`);
		table(['vs Avg', 'difference', '95% CI', 'p', 'Holm'], row.versus.map((entry) => [
			entry.key, signed(entry.test.estimate), ciText(entry.test, (v) => signed(v)), pText(entry.test.p), pText(entry.test.adjusted),
		]));
	}
};
say(`By pick pool: how often each book's top player in each list scored, on the ${plural(allFive.length, 'window')}. The Avg is the best guide for a pool unless that pool's any-book test is significant.`);
table(['pool', ...KEYS.map(keyName), 'any book p', 'Holm'], perPoolBooks.map((row) => [
	`Pick #${row.sid}`, ...KEYS.map((key) => pct(row.rates[key])), pText(row.p), pText(row.adjusted),
]));
versusRows(perPoolBooks, (row) => `Pick #${row.sid}`);
say('');
say('By slot: the first window of each slot per day, the windows the app\'s audit reads when it weights the books for Best Streak Picks.');
table(['slot', 'days', ...KEYS.map(keyName), 'any book p', 'Holm'], perSlotBooks.map((row) => [
	bucketName(row.bucket), row.days, ...KEYS.map((key) => pct(row.rates[key], 0)), pText(row.p), pText(row.adjusted),
]));
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
	formatTable('Sportsbooks (primary): the range of the five tickets\' rates; the difference tests whether the books\' gaps change', formatTests.filter((test) => test.type === 'books'));
	formatTable(`Player level (secondary): each book's AUC minus the Avg's, over ${formatAucs.map((entry) => entry.rows.toLocaleString('en-US')).join(' and ')} player-days`, formatTests.filter((test) => test.type === 'auc'));
	for (const test of formatTests.filter((entry) => entry.type === 'books')) {
		test.formats.forEach((part, f) => {
			if (part.adjusted >= ALPHA) return;
			say('');
			say(`In ${formatName(FORMATS[f])}, ${test.label}: each book vs the Avg (Holm over the four):`);
			table(['vs Avg', 'difference', '95% CI', 'p', 'Holm'], part.versus.map((entry) => [
				entry.key, signed(entry.test.estimate), ciText(entry.test, (v) => signed(v)), pText(entry.test.p), pText(entry.test.adjusted),
			]));
		});
	}
	say('');
	say(`A difference needs ${CONTRAST_DAYS}+ days in each format ("-" otherwise; with fewer, its test finds differences that aren't there too often).`);
	say('Differences of paired results are tested by shuffling the formats among the days, since most days differ by a whole result or not at all.');
	say('Not split: the table\'s factors and settling, since the app keeps one table for both formats and a format difference in');
	say('correlation shows in the lifts and backtests here; the other backtests; the secondary slot and book tests.');
}

if (options.out) {
	const outDir = expand(options.out);
	mkdirSync(outDir, { recursive: true });
	const plainWindows = windows.map((window) => ({
		...window,
		rows: window.rows.map((row) => ({ ...row })),
		books: Object.fromEntries(Object.entries(window.books).map(([key, book]) => [key, { top: book.top, shapes: book.shapes }])),
	}));
	writeFileSync(join(outDir, 'windows.json'), `${JSON.stringify(plainWindows)}\n`);
	writeFileSync(join(outDir, 'results.json'), `${JSON.stringify({ manifest, coverage, rebuild, results, correlationPrimary, slotPrimary }, null, '\t')}\n`);
	writeFileSync(join(outDir, 'table.json'), `${JSON.stringify(fullTable, null, 4)}\n`);
	say('');
	say(`Saved the rebuilt windows, the results and this archive's table to ${shortPath(outDir)}`);
}

console.log(out.join('\n'));
await cleanup();
