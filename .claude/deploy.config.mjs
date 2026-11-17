// This project's additions to the /deploy skill, which builds a branch's committed files in a temp folder
// and copies the build into the live folder. The skill is shared between projects and knows nothing of
// the server side here, so this file adds it: the data the server owns, where the live and update
// folders are, and the PHP that has to land in a set order, as docs/deployment.md describes.
//
// The repo is public, so nothing here names a host or a path on the server. The folders are found the
// way the health-server survey finds them.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { locate } from './skills/health-server/scripts/folders.mjs';

// Copied back to back, the library first, then update.php into the update folder: a new update.php that
// calls something the old library lacks dies on every cron run until the library catches up
const LIB_FIRST = ['fetch_lib.php', 'sportsbooks.json'];
// Cron calls update.php at the top of each minute, and the run loads its PHP straight away. The PHP step
// waits for this stretch of the minute, so no run can load the library and update.php from two releases
const QUIET_FROM = 5;
const QUIET_UNTIL = 50;

const isFile = (path) => { try { return statSync(path).isFile(); } catch { return false; } };
const sleep = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

export default {
	// The server owns these: cron writes the data and players folders, the History action builds the archive,
	// and the credentials file is rewritten in place
	neverCopy: ['data', 'history', 'players', 'auth.json'],

	// Overrides for when the folders can't be found from the cron line, the same as the survey's
	options: ['update', 'lib'],

	locate({ repoRoot, options }) {
		// update.php loads the library from the live folder, so the two are only found together: a live folder
		// named on its own would get the new library while the new update.php went on loading the old one
		if (options.live) throw new Error('--live can\'t name the live folder on its own here, since update.php loads the library from it; it\'s found from the cron line, or from --update <dir> and --lib <path>');
		const { updateDir, liveDir, insideRepo } = locate({ repoRoot, update: options.update, lib: options.lib });
		if (!updateDir) throw new Error('the update folder wasn\'t found from the cron line or the web server config; pass --update <dir>');
		if (!liveDir) throw new Error('the live folder wasn\'t found, since no cron line gives its lib; pass --lib <path>');
		if (insideRepo(updateDir)) throw new Error(`${updateDir} is inside this checkout, not a deployed folder`);
		if (!isFile(join(updateDir, 'update.php'))) throw new Error(`${updateDir} has no update.php, so it isn't the update folder`);
		if (!isFile(join(liveDir, 'fetch_lib.php'))) throw new Error(`${liveDir} has no fetch_lib.php, so it isn't the live folder`);
		console.log(`Update folder: ${updateDir}`);
		return { liveDir, updateDir };
	},

	// After the front end: the library, the book list and update.php back to back, in a quiet part of the
	// minute; then the rest of the live folder's files, and the update folder's other files where they're
	// already deployed, since the seeder files stay local and are never added
	steps({ src, out, liveDir, located, files }) {
		const { updateDir } = located;
		const updateSrc = join(src, 'timspicks_update');
		const live = (path) => ({ from: join(out, path), to: join(liveDir, path) });
		const update = (path) => ({ from: join(updateSrc, path), to: join(updateDir, path), label: `${path} into the update folder` });
		const rest = files.filter((path) => !path.startsWith('assets/') && path !== 'index.html' && !LIB_FIRST.includes(path));
		const seeders = readdirSync(updateSrc).filter((name) => name !== 'update.php' && name !== '.DS_Store' && isFile(join(updateSrc, name)) && isFile(join(updateDir, name)));
		return [
			{
				files: [...LIB_FIRST.filter((path) => files.includes(path)).map(live), update('update.php')],
				before({ say }) {
					const now = Date.now();
					const second = (now % 60000) / 1000;
					if (second >= QUIET_FROM && second < QUIET_UNTIL) return;
					const until = now - (now % 60000) + QUIET_FROM * 1000 + (second >= QUIET_UNTIL ? 60000 : 0);
					say(`Waiting ${Math.ceil((until - now) / 1000)} s, so the PHP lands after this minute's cron run has loaded its own`);
					sleep(until - Date.now());
				},
			},
			{ files: [...rest.map(live), ...seeders.sort().map(update)] },
		];
	},
};
