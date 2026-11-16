// Finds the cron line that drives update.php, the web server config, and the update and live folders that
// line points at. Shared by the health-server survey and the deploy script, so both always agree on where
// the live site is.
//
// The repo is public, so nothing here names a host or a path on the server. Everything is read at run time:
// the cron line gives the update URL and its lib value, the web server config maps that URL to the update
// folder, and the live folder is lib beside it, the same path update.php builds.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const home = homedir();
const expand = (path) => (path ? resolve(path.replace(/^~(?=$|\/)/, home)) : null);
const tryRun = (command, commandArgs) => {
	try {
		return execFileSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\n$/, '');
	} catch {
		return null;
	}
};
const statOf = (path) => { try { return statSync(path); } catch { return null; } };
const isFile = (path) => !!path && !!statOf(path)?.isFile();
const isDir = (path) => !!path && !!statOf(path)?.isDirectory();
const listDir = (path) => { try { return readdirSync(path); } catch { return []; } };
const readText = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
const realOr = (path) => { try { return realpathSync(path); } catch { return path; } };

// The update folder holds update.php, and update.php loads fetch_lib.php from ../<lib>
export const validUpdate = (dir, lib) => isFile(join(dir, 'update.php')) && isFile(join(dir, '..', lib, 'fetch_lib.php'));

// repoRoot: the checkout, whose own timspicks_update/ is the source and never counts as the deployed copy.
// update, lib: overrides for when discovery fails.
export const locate = ({ repoRoot, update = null, lib: libOption = null }) => {
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
	// Every request that reaches the web server gets a line here, which makes it the record of every cron call
	const accessLogs = [...new Set([...confText.matchAll(/^\s*(?:CustomLog|TransferLog)\s+(?:"([^"\n]+)"|(\S+))/gm)].map((match) => match[1] ?? match[2]))]
		.filter((path) => path.startsWith('/') && isFile(path));

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
	if (update) {
		updateDir = expand(update);
		updateHow = '--update';
		job = preferred.find((candidate) => validUpdate(updateDir, libOption ?? candidate.lib)) ?? preferred[0] ?? null;
	} else {
		let scanned = null;
		for (const candidate of preferred.length ? preferred : [{ lib: libOption, urlPath: '/update.php' }]) {
			const lib = libOption ?? candidate.lib;
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
	const lib = libOption ?? job?.lib ?? null;
	const liveDir = updateDir && lib ? resolve(updateDir, '..', lib) : null;

	return {
		processes, cronJobs, webServerRunning, httpdConf, documentRoots, serverLogs, accessLogs,
		job, updateDir, updateHow, updateOthers, lib, liveDir, insideRepo,
	};
};
