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
   on `development`. It never pushes, and it prints the copy list for step 4
   and 5.
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
3. **Build** in that same checkout: `npm install` only if dependencies changed,
   then `npm run build`. Nothing needs pulling, since the merge happened right
   here, and a fast-forward leaves `main` and `development` on the same commit,
   so either one builds the batch you just merged.
4. **Copy the front end** into the live folder, in this order: `dist/assets/*`
   first, then `dist/index.html`. The index names the hashed asset files, so
   putting it first means anyone loading the site in between asks for files that
   aren't there yet.
5. **Copy changed PHP**, in this order: `public/*` into the live folder first,
   then `update.php` into the update folder. This is the step that's easy to
   skip, because the build doesn't involve it — and until it happens the
   scrapers haven't changed at all. The cron loads the scraping library out of
   the live folder, not the checkout. The order matters because the library
   gives every new parameter a default, so a new library still works under the
   old update script, but nothing protects the reverse: a new update script that
   calls a library function the old library doesn't have yet dies on every cron
   run until the library catches up. Dying that early also means no start stamp
   gets recorded, so the failed-run gate never engages and it retries every
   minute.

**Never copy `dist/data`, `dist/history`, `dist/players` or `dist/auth.json`.**
The build fills those from the checkout's own stale copies, while the server owns
the live ones: cron writes the data and players folders, the History action builds
the archive, and the credentials file is rewritten in place on rehash. Copying the
build output wholesale overwrites the live history index.

## Before the merge

Three settings decide whether a build is safe to ship, and `/commit` checks all
three — this is the list it's checking against:

- `analyze` in `src/features.ts` is `'OFF'`. The other values run generation or
  analysis in the app.
- `$savesrc` in `public/fetch_service.php` is `false`, or the server starts
  writing raw feed dumps.
- No history range's `end` date is today or later. See the season notes below for
  why that one matters so much.

## After

- The info popup shows the app version, so it tells you whether the live site is
  actually running the build you just copied, or a cached older one.
- The status banner reports stale data, which is the fastest read on whether the
  cron is still feeding the site.
- The cron log is append-only and a run emits at most one line, so the tail of
  it is the run history. `crontab -l` shows what's installed.

## Ending a season

- Set the season's final `end` in the range table in `public/fetch_service.php`,
  and only ever to a day that has finished.
- Run the History action once the last day is complete, so the archive covers
  the whole season before anything else changes.
- Turn on `offseasonBanner` in `src/features.ts`, then rebuild and deploy as
  usual.
- Leaving the cron running through the offseason costs nothing but log lines.
  Stopping it is fine too; the part to remember is the restart, because a cron
  still switched off is exactly how the start of 2026-27 lost two days.

## Beginning a season

- Add the new season to the range table in `public/fetch_service.php`: a
  regular-season row from the opener, and a playoff row once those dates exist.
  Finished seasons stay commented out above it.
- Keep the `end` at the last completed day, every time you bump it. The history
  feed returns 404 for a day that isn't over, and the incremental index writes
  that day down as done and never asks for it again.
- Confirm the cron is running before the first game day, not after it.
- Turn `offseasonBanner` back off.
- If days were missed, backfill them: one closing price per player in every slot
  from an odds archive into `public/data/<date>`, with the pick lists rebuilt
  from the per-player available times the history feed reports. Then copy those
  dated folders into the live folder's data folder, along with
  `fetch_service.php`. That is a specific exception to the never-copy rule above
  — dated folders by hand, never `dist/data` wholesale.
- One trap when backfilling: the live `history.json` only ever extends forward
  from the end it has stored. If it already holds an entry for the new season
  that starts after the days you just backfilled, that entry has to be deleted,
  or those earlier days are never fetched.
