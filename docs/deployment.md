# Deploying

The daily routine for getting a finished batch onto the live site, plus the
things that only come up at the two ends of a season. As in the other docs,
exact hosts and paths are left out: "the live folder" and "the update folder"
stand in for them, the same way the `/commit` scan reports them.

One machine does both jobs: it holds the working checkout where batches are
built, and it serves the live site. Neither the live folder nor the update
folder is that checkout — both hold copies made out of it, which is why the
copying below is a step at all.

## The daily flow

1. **Finish the batch** with `/commit`. It reviews everything since the last
   version commit, commits it in groups, and ends with a `Version X.Y.Z` commit
   on `development`. It never pushes, and it prints the copy list, which is
   what step 3 deploys.
2. **Merge and push.** `main` is the branch a deploy is built from, so the batch
   has to land there:

   ```
   git checkout main
   git merge development
   git push
   git checkout development
   ```

   The merge is a fast-forward as long as nothing commits directly to `main`.
   `/commit` reports how far `main` is behind, and whether it holds anything
   `development` lacks, which is the signal that it won't be.
3. **Deploy** with `/deploy`, or from a terminal in the checkout:

   ```
   node .claude/skills/deploy/scripts/deploy.mjs
   ```

   It deploys `main`, whatever is checked out; `--branch <name>` deploys another
   branch instead. It never switches branches or builds in the checkout. It takes
   the branch's committed files into a temp folder and runs `npm ci` and
   `npm run build` there, so the build has exactly the packages the lockfile
   pins, and none of the checkout's uncommitted work or data can reach the live
   site. A failed build copies nothing. `--dry-run` builds and lists what it
   would copy without copying it.

   The deploy skill is shared between projects, so it is linked into the
   checkout and not committed here. What is committed is this project's part of
   it, a settings file that names the data the server owns, finds the live and
   update folders, and adds the PHP steps below. In a fresh clone, neither
   `/deploy` nor the command above works until the skill is linked.

### What the deploy copies, and in what order

The deploy finds the live and update folders from the cron line and the web
server config, the same way `/health-server` does, and copies only files whose
bytes differ. Each file is written beside its target and renamed over it, so
nothing is ever served half-written. The order is what makes a deploy safe while
the site and the cron keep running, and it's the same order to follow when
copying by hand:

1. **The front end:** `dist/assets/*` first, then `dist/index.html`. The index
   names the hashed asset files, so putting it first means anyone loading the
   site in between asks for files that aren't there yet. Asset files from older
   builds are removed last, once everything else has landed and checked out,
   except those of the build the deploy replaces: they stay until the next
   deploy, since a visitor who loaded the page before the switch can still ask
   for them. A file the live page still loads is never removed. By hand,
   leaving them is harmless.
2. **The scraping library, the book list and `update.php`, back to back:**
   `public/fetch_lib.php` and `public/sportsbooks.json` into the live folder,
   then `update.php` into the update folder. This is the step that's easy to skip
   by hand, because the build doesn't involve it — and until it happens the
   scrapers haven't changed at all. The cron loads the scraping library out of
   the live folder, not the checkout. The order matters because the library gives
   every new parameter a default, so a new library still works under the old
   update script, but nothing protects the reverse: a new update script that
   calls a library function the old library doesn't have yet dies on every cron
   run until the library catches up. Dying that early also means no start stamp
   gets recorded, so the failed-run gate never engages and it retries every
   minute.

   The book list travels with the PHP: the scraping library reads it from the
   live folder on every run, and a list it can't read stops every run at the
   books. A release that drops a library function the old update script calls
   can't keep that order safe either way, which is why the three go back to back.
   The deploy also waits, when it has to, for a part of the minute when the cron
   isn't starting a run, so no run loads the library and the update script from
   two different releases. By hand, a cron run that lands between them fails once
   and retries.
3. **The rest of the PHP and the static files** into the live folder, and the
   update folder's other files where they're already deployed. The seeder files
   are never added to it, since they stay local.

**Never copy `dist/data`, `dist/players` or `dist/auth.json`,** and the deploy
never does. A build made in the checkout fills those from its own stale copies,
while the server owns the live ones: cron writes the data and players folders,
the archive among them, and the credentials file is rewritten in place on rehash.
Copying the build output wholesale rolls back the live data, the archive with it.
The deploy's own build comes from the committed files alone, which don't include
any of them.

## Changing a book's mode

The book list sets each book's mode: `direct` for its own site, `comparison` for
the odds-comparison pages, `off` for neither. Switching a book between `direct`
and `comparison` touches only the scrapers, so copying the edited
`public/sportsbooks.json` into the live folder is the whole deploy. Turning a book
`off`, or back on, also changes what the page shows, and the front end is built
from the list, so that one goes through the full flow above. Edit the list in the
checkout and bring it to `main` like any other change, never the live copy alone:
a deploy copies `main`'s list, so a change made anywhere else is undone by the
next one.

## Before the merge

Two settings decide whether a build is safe to ship, and `/commit` checks both —
this is the list it's checking against:

- `analyze` in `src/features.ts` is `'OFF'`. The other values run generation or
  analysis in the app.
- `$savesrc` in `public/fetch_service.php` is `false`, or the server starts
  writing raw feed dumps.

## After

- The info popup shows the app version, so it tells you whether the live site is
  actually running the build you just copied, or a cached older one.
- The status banner reports stale data, which is the fastest read on whether the
  cron is still feeding the site.
- The cron log is append-only and a run emits at most one line, so the tail of
  it is the run history. `crontab -l` shows what's installed.
- `/health-server` covers the server side in one pass. It compares the files in
  the live and update folders with `main`, which says whether the deploy is
  complete. It reads the PHP error log, the web server's access log and cron
  mail along with the cron log, since a PHP fatal error, a cron that has stopped
  firing or a curl call that never reached the server leaves nothing in the cron
  log.

## Ending a season

- Once the last day is complete, check that `/health-server` lists no day with
  snapshots and no final scores, and run Update on the admin page for any it
  does, so the archive covers the whole season before anything else changes.
- Turn on `offseasonBanner` in `src/features.ts`, then rebuild and deploy as
  usual.
- Leaving the cron running through the offseason costs nothing but log lines.
  Stopping it is fine too; the part to remember is the restart, because a cron
  still switched off is exactly how the start of 2026-27 lost two days.

## Beginning a season

- Nothing needs adding for the new season's archive: each day's scores file takes
  its season and format from the score feed.
- Confirm the cron is running before the first game day, not after it.
  `/health-server` reports whether it is.
- Turn `offseasonBanner` back off.
- If days were missed, backfill them: one closing price per player in every slot
  from an odds archive into `public/data/<date>`, with the pick lists rebuilt
  from the per-player available times the pick-list site's history feed reports
  for that day. Then copy those dated folders into the live folder's data folder,
  and run Update on the admin page, which fetches those days' scores and adds them
  to the archive a few days at a time, so run it again while it reports earlier
  days left. That is a specific exception to the never-copy rule above — dated
  folders by hand, never `dist/data` wholesale.
- Any backfill, of missed days or of a book added later, marks every book file it
  writes in that slot's `backfill.json` as `"closing"`, and never replaces a book
  file already there. A backfilled price looks like a captured one; the mark is
  the only way an analysis can tell them apart.
