---
name: server-health
description: Check the live server's health from the machine it runs on. Reads the cron log and the two places cron failures hide (the PHP error log and cron mail), the live data folder (run state, today's feeds, the site banner, snapshot folders), and whether the files deployed to the live and update folders match main. Read-only. Use when asked whether the live site or the cron is healthy, why the live data looks stale, or whether a deploy is complete.
argument-hint: "[ref] [--days N] [--no-build]"
allowed-tools: Read, Grep, Glob, Bash(node .claude/skills/server-health/scripts/health.mjs:*), Bash(git fetch:*), Bash(git show:*), Bash(git diff:*), Bash(git log:*), Bash(git rev-parse:*), Bash(crontab -l), Bash(tail:*), Bash(ls:*), Bash(cmp:*), Bash(diff:*)
---

# Live server health

Arguments: $ARGUMENTS

This skill runs on the live server itself, in this checkout, which is also where batches are built. It only reads. Never:
- copy, deploy, move or delete anything in the live or update folders
- edit the crontab, or anything in `data/`, `players/`, `history/` or `auth.json`
- request `update.php`, `fetch_service.php` or `fetch.php` over HTTP, because each one runs the scrapers or acts on the live data
- print what `auth.json` holds

The repo is public, and the docs leave hosts and server paths out on purpose. The report shows local paths and masks hosts. Keep both out of anything tracked: code, docs and commit messages.

## 1. Run the survey

Update the remote refs first, so the deploy check compares against the current main. Skip this when offline, and say so:

    git fetch --quiet origin

Then run the survey, passing the arguments through:

    node .claude/skills/server-health/scripts/health.mjs $ARGUMENTS

- `[ref]` or `--ref <ref>`: what the live files should match. Defaults to `origin/main`.
- `--days N`: how far back the history sections look. Defaults to 7.
- `--no-build`: skips the reference build, so the front end is checked by version only.
- `--update <dir>`, `--lib <path>`, `--log <file>`, `--php-log <file>`: overrides for when discovery fails. The report's Paths section says which one it needs.

The survey finds everything itself. The cron line gives the update URL, its `lib` value and the log file. The web server config maps that URL to the update folder. The live folder is `lib` beside it, the same path `update.php` builds.

The reference build takes a few seconds. The survey archives the ref into a temp folder, builds it there with this checkout's `node_modules`, compares, and deletes the folder. `dist/` and the working tree are never touched.

## 2. Reading the report

The report starts with a verdict and an **Attention** list:
- **FAIL** means broken now. The site can't load, the cron isn't running or is overdue, the latest run failed, or PHP logged a fatal error in the last 24 hours.
- **WARN** means degraded, or something to follow up.

Older history in the window is listed in the sections, but only flagged within the last 48 hours.

**Cron.** The cron calls `update.php` every minute, and `update.php` throttles itself (docs/app-and-server.md, "Cadence"). So the log gets one line per run that did work: a snapshot path, a `Complete` line, or a step's error.
- Errors are grouped by kind. A failure streak that retries every minute means the failed-run gate never engaged. That happens when a run dies before `startRun()` (docs/deployment.md, step 5).
- The per-day table lists gaps over 75 minutes between midnight and the day's last start. A game day with no runs at all is a day the cron was off. Gaps aren't flagged on their own, because an Update from the admin page resets the hourly clock without writing to the cron log. A gap is a real miss when cron mail shows a silence across it, or the PHP log shows an error inside it.
- **PHP error log.** PHP doesn't display errors on this server, so a fatal error in `update.php` or `fetch_lib.php` writes nothing to the cron log. It only shows up in PHP's own log. The survey keeps the entries that name the live or update folder. A "Failed opening required" fatal for `fetch_lib.php` around a deploy usually means the cron ran while files were being copied.
- **Cron mail.** curl's progress meter goes to stderr, so cron mails it on every call, which makes the mail a record of every call. A silence over 15 minutes means cron itself didn't fire, because the machine slept or cron stopped. A `curl: (N)` line means the call never reached the web server. Cron sometimes fires the job twice in one minute. The throttle absorbs the extra call, and "Minutes with two or more runs" in the cron log section flags the rare case where both got through.

**Data.** The survey reads the live data the way the app and the cron read it.
- "Site banner now" applies the app's own rules, from `getDataStatus` in src/dataProcessor.ts and App.tsx, so it says what visitors see.
- "Next run" applies `update.php`'s gate to say when a run is due. A run more than five minutes overdue is flagged.
- A team still listed after its game started means the feed hadn't redrawn when the last pull landed.
- "No draw stamp" means the deployed `fetch_lib.php` predates the stamp, so the rollover check for an earlier day's list can't run yet.
- Every listed player needs `players/<id>.json`. One missing file stops the whole page from loading.
- **Snapshots.** Each `data/<date>/<HHMM>` folder is named for a game's ET start and written by the runs before it (docs/app-and-server.md, "What lands on disk"). The first folder of the day waits for the first run after 3 a.m. A folder still missing after its game started can't be recovered by the cron. Backfilling is described in docs/deployment.md, under "Beginning a season".

**Deploy.** The live files are held against the ref, never against this working tree, because unreleased work on `development` isn't meant to be live.
- The update folder only needs `update.php`. The seeder files stay local, so they're compared only when present.
- The live folder is compared without `data/`, `history/`, `players/` and `auth.json`, which a deploy never copies.
- The bundler names a script after the folder it was built in as well as its contents. So assets are matched by content, and `index.html` is compared with the live names swapped in.
- Leftover assets from older builds are harmless.
- The copy list follows the order in docs/deployment.md: the front-end assets, then `index.html`, then the PHP in the live folder, then `update.php`.

**Server.** This covers free disk space, the size of the web server's log folder and the cron mail spool. The spool grows with every call, because of the progress meter. `curl -sS` in the cron line would stop that and still mail curl's errors, but the survey would lose its view of when cron didn't fire. Suggest it with that trade-off, and never apply it.

## 3. Dig into what's flagged

Stay read-only. Useful moves:
- The cron log lines around a time: `tail -n 60 <cron log>`, or Grep for the date.
- What differs in a deployed file: `git show <ref>:public/<file> | diff - <live folder>/<file>`. For `update.php`, use `timspicks_update/update.php` and the update folder's copy.
- A snapshot folder: `ls <live folder>/data/<date>/<HHMM>`.
- A PHP error in full: Grep the PHP error log for its message. Entries can span several lines.

## 4. Report

Keep it short. Lead with the verdict and the one or two facts behind it, then give:
1. The issues, most severe first. For each, say what it means for the site and what fixes it.
2. The copy list in deploy order, if there is one. Deploying is the user's call, so offer the steps and never run them.
3. Anything the survey couldn't check, such as a skipped build, a missing ref or a log it couldn't find.
4. Informational notes last, in a line or two: disk, log sizes, older history.

Don't paste the whole report back, and keep hosts out of the reply. The survey already masks them.
