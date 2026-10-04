#!/usr/bin/env node
// Read-only survey for the commit skill. Prints the review baseline, the commits and files to
// review, link and prose findings, release checks and the live update list. Changes nothing.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

const AUTHOR = 'snovakow';
const VERSION_MESSAGE = /^Version (\d+\.\d+\.\d+)$/;
const VERSION_LOOKALIKE = /^version\s+v?\d|^release\s+v?\d+\.\d|^v\d+\.\d|\bversion\b.*\d+\.\d+\.\d+/i;
const VERSION_FILES = ['package-lock.json', 'package.json'];
const FRONTEND_FILES = new Set(['index.html', 'vite.config.ts', 'package.json', 'package-lock.json']);
const LIVE_FOLDER = 'the live folder';
const UPDATE_FOLDER = 'the update folder';
const NEVER_COPY = 'dist/data, dist/history, dist/players, dist/auth.json';

const SCHEME_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`<>)\]]+/gi;
const WWW_HOST = /\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const BARE_DOMAIN = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|ca|bet|co|us|uk|ai|app|dev|gg|tv|info|me|news|online|site|xyz)(?![a-z0-9-]|\.[a-z0-9])/gi;
const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;
const XMLNS = /\bxmlns(?::[\w-]+)?\s*=\s*"[^"]*"/g;
// A markdown link matters only when it leaves the repo; a relative path names no site. Not
// global, so .test() stays stateless.
const LINK_TARGET_HOST = new RegExp(`${SCHEME_URL.source}|${WWW_HOST.source}|${BARE_DOMAIN.source}|^//`, 'i');
const externalLinks = (text) => [...text.matchAll(MARKDOWN_LINK)]
	.filter(([, target]) => LINK_TARGET_HOST.test(target))
	.map(([match]) => match);
const TRAILER = /^(co-authored-by|signed-off-by):/i;
const PROSE_FILE = /\.(md|markdown|txt|html?)$/i;
const HASH_COMMENT_FILE = /\.(php|sh|zsh|bash|py|ya?ml|toml|ini|conf)$|(^|\/)\.gitignore$/i;

// Credentials and copied browser-session data. The scrapers legitimately send browser-like
// headers, but a pasted Cookie header also carries the session, ad and fingerprint ids of
// whoever copied it, and those stay in the public history forever.
const SECRET_PATTERNS = [
	[/\bCURLOPT_COOKIE(?:FILE|JAR)?\b/i, 'cookie sent with a request'],
	[/(?:^|['"\s])(?:set-)?cookie\s*:/i, 'cookie header'],
	[/(?:^|['"\s])authorization\s*:/i, 'authorization header'],
	[/\bBearer\s+[\w.~+/-]{12,}/, 'bearer token'],
	[/(?:^|['"\s])x-api-key\s*:/i, 'api key header'],
	[/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\b\s*[=:]\s*['"`]?[\w.~+/-]{8,}/i, 'key or token value'],
	[/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, 'private key'],
	[/(?:^|['"\s])(?:traceparent|tracestate|x-correlation-id|x-datadog-[a-z-]+)\s*:/i, 'session or trace id header'],
	[/\bbrowserfingerprint\b/i, 'browser fingerprint'],
];
// This skill's own files spell out the patterns above, so they would always match themselves.
const SELF_FILE = /(^|\/)\.claude\/skills\/commit\//;
// Long opaque values are the payload, so they never reach the output.
const maskValues = (text) => text.replace(/(['"`])((?:(?!\1).){24,})\1/g, (_, quote) => `${quote}…${quote}`);

const git = (...args) => execFileSync('git', args, {
	encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'],
}).replace(/\n$/, '');
const tryGit = (...args) => {
	try { return git(...args); } catch { return null; }
};
const lines = (text) => (text ? text.split('\n').filter(Boolean) : []);
const short = (sha) => sha.slice(0, 7);
const clip = (text, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const parseJson = (text) => {
	try { return text ? JSON.parse(text) : null; } catch { return null; }
};
const jsonAt = (rev, path) => (rev ? parseJson(tryGit('show', `${rev}:${path}`)) : null);
const jsonNow = (path) => parseJson(readText(path));
const versionAt = (rev) => jsonAt(rev, 'package.json')?.version ?? null;

process.chdir(git('rev-parse', '--show-toplevel'));
const out = [];
const section = (title) => out.push('', `## ${title}`);
const say = (text = '') => out.push(text);

// --- State -------------------------------------------------------------------------------------

const branch = tryGit('symbolic-ref', '--short', '-q', 'HEAD');
const upstream = tryGit('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
const [behind, ahead] = upstream
	? git('rev-list', '--left-right', '--count', '@{u}...HEAD').split(/\s+/).map(Number)
	: [0, 0];
const operations = [
	['rebase-merge', 'rebase'], ['rebase-apply', 'rebase'], ['MERGE_HEAD', 'merge'],
	['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert'],
].filter(([name]) => existsSync(git('rev-parse', '--git-path', name))).map(([, label]) => label);
const userName = tryGit('config', 'user.name');

// Pushed means reachable from any remote-tracking branch; only commits outside that set can be rewritten.
const unpushed = new Set(lines(git('rev-list', 'HEAD', '--not', '--remotes')));
const pushedTip = lines(git('rev-list', '--first-parent', 'HEAD')).find((sha) => !unpushed.has(sha)) ?? null;

// --- Baseline: the newest official version commit ------------------------------------------------

// Official: the whole message is exactly `Version X.Y.Z` (no body, no trailer), the author is
// snovakow, it changes exactly package.json and package-lock.json, and package.json holds X.Y.Z.
// Anything else is an ordinary commit, however much it looks like a version commit.
const candidates = git('log', '--full-history', '--format=%H%x1f%an%x1f%B%x1e', 'HEAD', '--', 'package.json')
	.split('\x1e').map((record) => record.trim()).filter(Boolean)
	.map((record) => {
		const [sha, author, message = ''] = record.split('\x1f');
		return { sha, author, message: message.trim() };
	});
const isOfficial = ({ sha, author, message }) => {
	const match = VERSION_MESSAGE.exec(message);
	if (!match || author !== AUTHOR) return false;
	const files = lines(git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha)).sort();
	if (files.join('\n') !== VERSION_FILES.join('\n')) return false;
	return versionAt(sha) === match[1];
};
const official = candidates.find(isOfficial) ?? null;
const officialVersion = official ? VERSION_MESSAGE.exec(official.message)[1] : null;
const baseline = official?.sha ?? pushedTip;
const rewriteBase = official && !unpushed.has(official.sha) ? pushedTip : baseline;

const headVersion = versionAt('HEAD');
const worktreeVersion = jsonNow('package.json')?.version ?? null;
// Only /commit changes the version, so HEAD and the working tree should still hold the baseline's.
const expectedVersion = officialVersion ?? (baseline ? versionAt(baseline) : null) ?? '0.0.0';
const nextVersion = expectedVersion.replace(/\d+$/, (n) => String(Number(n) + 1));

// --- Range: commits after the baseline, plus the working tree ------------------------------------

const rangeShas = lines(git('rev-list', '--reverse', '--topo-order', ...(baseline ? [`${baseline}..HEAD`] : ['HEAD'])));
const commits = rangeShas.map((sha) => {
	const [parents, author, date, ...rest] = git('log', '-1', '--format=%P%x1f%an%x1f%ad%x1f%B', '--date=short', sha).split('\x1f');
	const message = rest.join('\x1f').trim();
	const touchesVersion = VERSION_LOOKALIKE.test(message.split('\n')[0])
		|| (versionAt(sha) !== (parents ? versionAt(parents.split(' ')[0]) : null));
	return { sha, merge: parents.split(' ').length > 1, author, date, message, pushed: !unpushed.has(sha), touchesVersion };
});
const status = lines(git('status', '--short', '--untracked-files=all'));
const untracked = lines(git('ls-files', '--others', '--exclude-standard'));

// Added lines from a unified diff, with their line numbers in the new file.
const addedLines = (diff) => {
	const result = [];
	let file = null;
	let lineNo = 0;
	let inHeader = false;
	for (const line of diff.split('\n')) {
		if (line.startsWith('diff --git ')) { inHeader = true; file = null; continue; }
		if (inHeader) {
			if (line.startsWith('+++ ')) { file = line === '+++ /dev/null' ? null : line.slice(6); inHeader = false; }
			continue;
		}
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (hunk) { lineNo = Number(hunk[1]); continue; }
		if (line.startsWith('+')) { if (file) result.push({ file, line: lineNo, text: line.slice(1) }); lineNo++; }
		else if (line.startsWith(' ')) lineNo++;
	}
	return result;
};
const DIFF_FLAGS = ['--unified=0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
const commitAdded = (sha) => addedLines(git('show', '--format=', '--diff-merges=first-parent', ...DIFF_FLAGS, sha));
const worktreeAdded = () => addedLines(git('diff', 'HEAD', ...DIFF_FLAGS));
const untrackedAdded = (path) => {
	try {
		if (!statSync(path).isFile() || statSync(path).size > 2_000_000) return [];
		const buffer = readFileSync(path);
		if (buffer.subarray(0, 8000).includes(0)) return [];
		return buffer.toString('utf8').split('\n').map((text, index) => ({ file: path, line: index + 1, text }));
	} catch {
		return [];
	}
};

// The comment or document text of a line: where site names would be prose rather than code.
const proseOf = (file, text) => {
	const trimmed = text.trim();
	if (!trimmed || /\.svg$/i.test(file)) return null;
	if (PROSE_FILE.test(file)) return trimmed;
	if (/^(\/\*|\*)/.test(trimmed)) return trimmed;
	if (HASH_COMMENT_FILE.test(file) && trimmed.startsWith('#')) return trimmed;
	// Comment markers count only at the start or after whitespace, so URLs, paths and strings don't.
	const pieces = [
		/(?:^|\s)\/\/(.*)$/.exec(text)?.[1],
		/(?:^|[\s{(;])\/\*(.*?)(?:\*\/|$)/.exec(text)?.[1],
		/(?:^|[\s>])<!--(.*?)(?:-->|$)/.exec(text)?.[1],
	].filter((piece) => piece?.trim());
	return pieces.length ? pieces.join(' … ').trim() : null;
};

const linkHits = [];
const proseLines = [];
const secretHits = [];
const scanText = (where, file, line, text, proseOnly) => {
	const code = text.replace(XMLNS, '');
	if (!proseOnly && !SELF_FILE.test(file ?? '')) {
		for (const [pattern, label] of SECRET_PATTERNS) {
			if (pattern.test(code)) secretHits.push(`${where} ${file}:${line}  ${label}  | ${clip(maskValues(code.trim()), 100)}`);
		}
	}
	const prose = proseOnly ? code : proseOf(file, code);
	const urls = code.match(SCHEME_URL) ?? [];
	const found = new Set([
		...urls,
		...[...(code.match(WWW_HOST) ?? []), ...(prose?.match(BARE_DOMAIN) ?? [])].filter((host) => !urls.some((url) => url.includes(host))),
		...(prose ? externalLinks(prose).filter((link) => !urls.some((url) => link.includes(url))) : []),
	]);
	const location = file ? `${file}:${line}` : `line ${line}`;
	for (const match of found) linkHits.push(`${where} ${location}  ${match}  | ${clip(code.trim())}`);
	if (prose && !proseOnly) proseLines.push(`${where} ${location}  ${clip(prose)}`);
};

for (const commit of commits) {
	const label = `${short(commit.sha)}${commit.pushed ? ' (pushed)' : ''}`;
	commit.message.split('\n').forEach((text, index) => {
		if (!TRAILER.test(text.trim())) scanText(`msg ${label}`, null, index + 1, text, true);
	});
	for (const { file, line, text } of commitAdded(commit.sha)) scanText(label, file, line, text, false);
}
if (tryGit('rev-parse', '-q', '--verify', 'HEAD')) {
	for (const { file, line, text } of worktreeAdded()) scanText('worktree', file, line, text, false);
}
for (const path of untracked) {
	for (const { file, line, text } of untrackedAdded(path)) scanText('untracked', file, line, text, false);
}

// --- Release checks ------------------------------------------------------------------------------

const localDate = () => {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const today = localDate();
const features = readText('src/features.ts') ?? '';
const analyze = /\banalyze\b[^=\n]*=\s*'(\w+)'/.exec(features)?.[1] ?? 'not found';
const service = readText('public/fetch_service.php') ?? '';
const savesrc = /^\s*\$savesrc\s*=\s*(\w+)\s*;/m.exec(service)?.[1] ?? 'not found';
const lateEnds = service.split('\n').flatMap((text, index) => (text.trim().startsWith('//') ? []
	: [...text.matchAll(/'end'\s*=>\s*'(\d{4}-\d{2}-\d{2})'/g)]
		.filter((match) => match[1] >= today)
		.map((match) => `public/fetch_service.php:${index + 1} end ${match[1]}`)));
const flagChanges = baseline
	? lines(git('diff', baseline, '--unified=0', '--no-color', '--', 'src/features.ts')).filter((line) => /^[+-](?![+-])/.test(line))
	: [];

// --- Cross-file calls into fetch_lib.php --------------------------------------------------------

// update.php sits in its own tree and is deployed separately, and nothing builds or type-checks either
// caller against the lib, so a signature change shows up as a fatal in whichever branch happens to run.
// The top-level pieces of an argument or parameter list, starting at the index of its opening paren.
const listAt = (text, open) => {
	const parts = [];
	let depth = 0;
	let quote = null;
	let current = '';
	for (let index = open + 1; index < text.length; index += 1) {
		const char = text[index];
		if (quote) {
			if (char === '\\') { current += char + (text[index + 1] ?? ''); index += 1; continue; }
			if (char === quote) quote = null;
		} else if (char === "'" || char === '"') quote = char;
		else if (char === '(' || char === '[') depth += 1;
		else if (char === ')' && depth === 0) {
			parts.push(current);
			const trimmed = parts.map((part) => part.trim());
			return trimmed.length === 1 && trimmed[0] === '' ? [] : trimmed;
		} else if (char === ')' || char === ']') depth -= 1;
		else if (char === ',' && depth === 0) { parts.push(current); current = ''; continue; }
		current += char;
	}
	return null;
};

const LIB = 'public/fetch_lib.php';
const libText = readText(LIB) ?? '';
const signatures = new Map();
for (const match of libText.matchAll(/^function (\w+)\s*\(/gm)) {
	const params = listAt(libText, match.index + match[0].length - 1);
	if (params) signatures.set(match[1], { least: params.filter((param) => !param.includes('=')).length, most: params.length });
}

const arity = [];
for (const file of [LIB, 'public/fetch_service.php', 'timspicks_update/update.php']) {
	const text = readText(file) ?? '';
	for (const [name, { least, most }] of signatures) {
		for (const match of text.matchAll(new RegExp(`(?<![\\w$>])(?<!function )${name}\\s*\\(`, 'g'))) {
			const args = listAt(text, match.index + match[0].length - 1);
			if (!args || (args.length >= least && args.length <= most)) continue;
			const line = text.slice(0, match.index).split('\n').length;
			arity.push(`${file}:${line} passes ${args.length} to ${name}(), which takes ${least === most ? least : `${least}-${most}`}`);
		}
	}
}

// --- Docs: generated prose, so keep the code out of them ----------------------------------------

// Repo paths a doc names. Build and runtime output (dist/, data/, players/, history/, auth.json)
// is written on the server and absent here, so a missing one of those proves nothing.
const DOC_PATH = /`((?:src|public|docs|timspicks_update|\.claude)\/[A-Za-z0-9_./-]*)`/g;

// Backticks in these pages mark code, so every span is a candidate and the exceptions are listed
// instead. A page that carries the runbook marker is allowed to name what a step needs; it is
// reported separately rather than silently, since the allowance covers steps and not prose.
const RUNBOOK_MARKER = /^<!--\s*runbook\s*-->\s*$/;
const SPAN = /`([^`\n]+)`/g;
// Commands, git refs, and the data files and folders the server writes: a rename in src/ can't
// falsify any of them, so they aren't code references.
const NOT_CODE = [
	/^(?:npm|npx|node|git|php|curl|crontab|python3|sh|tsc|eslint|diff|grep)\b/,
	/^(?:main|development)$/,
	/^Version [X\d]/,
	/^\/[a-z-]+$/,
	/\.md$/,
	// Step 3 requires these as the app's own words for the books, so they belong in prose.
	/^bet[1-4](?:[–-]bet4)?$/,
	/^[A-Z][a-z]+\/[A-Z][A-Za-z_]+$/,
	/^(?:data|players|history)\/[A-Za-z0-9_<>.…\s-]*$/,
	/^[a-z][a-z0-9]*(?:\.\.[a-z0-9]+)?\.json$/,
	/^<[A-Za-z0-9_-]+>$/,
	/^<season>_<date>_<format>\.json$/,
];
const docFiles = [...lines(tryGit('ls-files', '--cached', '--others', '--exclude-standard', 'docs') ?? ''), 'README.md']
	.filter((file) => PROSE_FILE.test(file));
const dangling = [];
const codeRefs = new Map();
const seenRef = new Set();
for (const file of docFiles) {
	const text = readText(file) ?? '';
	const runbook = text.split('\n').some((line) => RUNBOOK_MARKER.test(line));
	const hits = new Map();
	let fenced = false;
	text.split('\n').forEach((line, index) => {
		if (/^\s*```/.test(line)) { fenced = !fenced; return; }
		for (const [, path] of line.matchAll(DOC_PATH)) {
			const key = `${file}\t${path}`;
			if (seenRef.has(key) || existsSync(path.replace(/\/$/, ''))) continue;
			seenRef.add(key);
			dangling.push(`${file}:${index + 1}  ${path}`);
		}
		// A fenced block is a command or a data layout, not a claim about the code.
		if (fenced) return;
		for (const [, span] of line.matchAll(SPAN)) {
			if (NOT_CODE.some((pattern) => pattern.test(span))) continue;
			if (!hits.has(span)) hits.set(span, index + 1);
		}
	});
	if (hits.size) codeRefs.set(file, { runbook, hits });
}

// An added, deleted or renamed source file can outdate what a page says exists, or a runbook step
// that names it. Edits inside existing files are left out; they would fill the list every batch.
const SOURCE_PATH = /^(?:src|public)\//;
const structural = baseline
	? lines(git('diff', '--name-status', '--find-renames', baseline)).flatMap((line) => {
		const [kind, ...paths] = line.split('\t');
		const path = paths[paths.length - 1];
		return kind[0] === 'M' || !SOURCE_PATH.test(path) ? [] : [`${kind[0]} ${paths.join(' -> ')}`];
	})
	: [];
for (const path of untracked) if (SOURCE_PATH.test(path)) structural.push(`A ${path}`);

const mainRef = tryGit('rev-parse', '-q', '--verify', 'origin/main') ? 'origin/main' : null;
const [mainOnly, branchOnly] = mainRef && branch && branch !== 'main'
	? git('rev-list', '--left-right', '--count', `${mainRef}...HEAD`).split(/\s+/).map(Number)
	: [null, null];

// --- Live update: what the server lacks since the newest pushed version --------------------------

const pushedVersion = candidates.find((candidate) => !unpushed.has(candidate.sha) && isOfficial(candidate)) ?? null;
const deployBase = pushedVersion?.sha ?? pushedTip;
const changes = new Map();
for (const line of deployBase ? lines(git('diff', '--name-status', '--no-renames', deployBase)) : lines(git('ls-files')).map((file) => `A\t${file}`)) {
	const [kind, path] = line.split('\t');
	changes.set(path, kind[0]);
}
for (const path of untracked) changes.set(path, 'A');

const withoutVersion = (pkg) => (pkg ? JSON.stringify({ ...pkg, version: undefined }) : null);
const lockWithoutVersion = (lock) => {
	if (!lock) return null;
	const copy = structuredClone(lock);
	delete copy.version;
	if (copy.packages?.['']) delete copy.packages[''].version;
	return JSON.stringify(copy);
};
const dependencies = (pkg) => (pkg ? JSON.stringify([pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies, pkg.overrides]) : null);
const packageBase = jsonAt(deployBase, 'package.json');
const packageNow = jsonNow('package.json');
const lockChanged = lockWithoutVersion(jsonAt(deployBase, 'package-lock.json')) !== lockWithoutVersion(jsonNow('package-lock.json'));
const packageChanged = withoutVersion(packageBase) !== withoutVersion(packageNow);
const dependenciesChanged = lockChanged || dependencies(packageBase) !== dependencies(packageNow);

const frontend = [];
const copies = [];
const noUpdate = [];
for (const [path, kind] of [...changes].sort(([a], [b]) => a.localeCompare(b))) {
	if (path.startsWith('src/') || FRONTEND_FILES.has(path)) {
		if ((path === 'package.json' && !packageChanged) || (path === 'package-lock.json' && !lockChanged)) continue;
		frontend.push(path);
	} else if (path.startsWith('public/') || path.startsWith('timspicks_update/')) {
		const [prefix, folder] = path.startsWith('public/') ? ['public/', LIVE_FOLDER] : ['timspicks_update/', UPDATE_FOLDER];
		const name = path.slice(prefix.length);
		copies.push(kind === 'D' ? `deleted ${path}: remove ${name} from ${folder} if present` : `${path} -> ${name} in ${folder}`);
	} else {
		noUpdate.push(path);
	}
}

// --- Output --------------------------------------------------------------------------------------

const attention = [
	...operations.map((op) => `${op} in progress`),
	...(branch ? [] : ['HEAD is detached']),
	...(behind ? [`branch is ${behind} commit(s) behind ${upstream}`] : []),
	...(branch === 'main' ? ['on main; work normally lands on development'] : []),
	...(userName === AUTHOR ? [] : [`git user.name is ${userName ?? 'unset'}, not ${AUTHOR}; the version commit would not count`]),
	...(headVersion !== expectedVersion || worktreeVersion !== expectedVersion
		? [`version changed outside /commit: HEAD ${headVersion}, working tree ${worktreeVersion}, expected ${expectedVersion} from ${official ? 'the last version commit' : 'the baseline'}`] : []),
	...(analyze === 'OFF' ? [] : [`src/features.ts analyze is '${analyze}', not 'OFF'`]),
	...(savesrc === 'false' ? [] : [`public/fetch_service.php $savesrc is ${savesrc}`]),
	...arity.map((item) => `call does not match its fetch_lib.php signature: ${item}`),
	...lateEnds.map((end) => `History end date is today or later (${today}): ${end}`),
	...(secretHits.length ? [`${secretHits.length} line(s) add credentials or copied session data; see Secrets and session data`] : []),
];

say('# Commit survey');
section('Attention');
for (const item of attention.length ? attention : ['(none)']) say(`- ${item}`);

section('State');
say(`Branch: ${branch ?? '(detached)'}${upstream ? `, upstream ${upstream} (ahead ${ahead}, behind ${behind})` : ', no upstream'}`);
say(`Git user: ${userName ?? '(unset)'}`);
say(`Baseline: ${official ? `${short(official.sha)} ${official.message} (${unpushed.has(official.sha) ? 'unpushed' : 'pushed'})` : `no version commit yet; newest pushed commit ${pushedTip ? `${short(pushedTip)} ${git('log', '-1', '--format=%s', pushedTip)}` : '(none)'}`}`);
say(`Rewrite base: ${rewriteBase ? short(rewriteBase) : '(root)'}; only commits after it may be rewritten`);
say(`Version: last version commit ${officialVersion ?? '(none)'}, HEAD ${headVersion}, working tree ${worktreeVersion}, next ${nextVersion}`);
const lookalikes = commits.filter((commit) => commit.touchesVersion);
say(`Lookalikes (not baselines; reviewed like any range commit): ${lookalikes.length ? lookalikes.map((commit) => `${short(commit.sha)} ${commit.message.split('\n')[0]}`).join('; ') : 'none'}`);
if (mainRef && branchOnly !== null) say(`origin/main: ${branchOnly} commit(s) behind ${branch}; ${mainOnly} commit(s) on main not in ${branch}`);

section(`Range commits (${commits.length}, oldest first)`);
for (const commit of commits) {
	say(`### ${short(commit.sha)} ${commit.pushed ? 'pushed' : 'unpushed'}${commit.merge ? ', merge' : ''} | ${commit.author} | ${commit.date}`);
	for (const text of commit.message.split('\n')) say(`    ${text}`);
}
if (!commits.length) say('(none)');

section('Working tree');
for (const line of status.length ? status : ['(clean)']) say(line);

section('Links and domains');
for (const hit of linkHits.length ? linkHits : ['(none)']) say(`- ${hit}`);

section('Prose to read (comments and docs added in the range)');
for (const line of proseLines.length ? proseLines : ['(none)']) say(`- ${line}`);

section('Secrets and session data');
for (const hit of secretHits.length ? secretHits : ['(none)']) say(`- ${hit}`);

section('Release checks');
say(`analyze: '${analyze}'`);
say(`$savesrc: ${savesrc}`);
say(`History end dates today or later: ${lateEnds.length ? lateEnds.join('; ') : 'none'}`);
say(`Feature flag changes since the baseline: ${flagChanges.length ? '' : 'none'}`);
for (const line of flagChanges) say(`    ${line}`);
say(`Calls into fetch_lib.php (${signatures.size} function(s)): ${arity.length ? '' : 'all match'}`);
for (const line of arity) say(`    ${line}`);

section('Docs (generated prose; keep the code out, see step 5a)');
say(`Code references: ${codeRefs.size ? '' : 'none'}`);
for (const [file, { runbook, hits }] of codeRefs) {
	const names = [...hits].map(([span, line]) => `${span} (:${line})`).join(', ');
	say(`    ${file}${runbook ? ' [runbook: allowed in steps only]' : ''} — ${hits.size}: ${names}`);
}
say(`Dangling path references: ${dangling.length ? '' : 'none'}`);
for (const line of dangling) say(`    ${line}`);
say(`Added, deleted or renamed under src/ or public/: ${structural.length ? '' : 'none'}`);
for (const line of structural) say(`    ${line}`);

section(`Live update (since ${deployBase ? `${short(deployBase)} ${git('log', '-1', '--format=%s', deployBase)}` : 'the first commit'})`);
say(`Built frontend: rebuild (${frontend.length ? `changed: ${frontend.join(', ')}` : 'version only'})`);
say(`    On the server: git pull, ${dependenciesChanged ? 'npm install (dependencies changed), ' : ''}npm run build, then copy dist/assets/* and after it dist/index.html into ${LIVE_FOLDER}`);
say('Individual files:');
for (const line of copies.length ? copies : ['(none)']) say(`    ${line}`);
say(`Never copy: ${NEVER_COPY}`);
say(`No live update: ${noUpdate.length ? noUpdate.join(', ') : '(none)'}`);

console.log(out.join('\n'));
