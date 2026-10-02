# The app and the server

How the pieces are wired, what ends up on disk, and how a change reaches the
live site. Exact hosts and paths are deliberately left out; "the live folder"
and "the update folder" stand in for them, the same way the `/commit` scan
reports them.

## Layout

Two sibling trees:

- **the site folder** — the built front end plus the PHP that scrapes and
  serves. `public/` in this repo; the live folder on the server.
- **the update folder** — the cron entry point. `timspicks_update/` in this
  repo; the update folder on the server.

`update.php` takes a `lib` query parameter, loads `fetch_lib.php` from that
folder one level up, and writes into the same folder's `data/` and `players/`.
So a single update script can drive more than one site folder — a local one and
the live one — by varying `lib`. Cron runs it, with the host elided here:

```
* * * * * curl "<update-host>/update.php?lib=<site-folder>" >> timspicks_log.txt
```

`crontab -l` lists what is installed. The log is append-only, and a run emits at
most one line.

The build sets `base: ""` (`vite.config.ts`), so every asset and data URL is
relative. That is what lets the same build run from a subfolder.

## Cadence: not once a minute

Cron fires every minute, but `update.php` throttles itself. Its two constants
are an update period of one hour and a buffer of 60 seconds:

- No updates between the day's last game and midnight.
- Otherwise update once per period, or as soon as a game start time has passed
  since the previous run.
- Never within the buffer of a game start time, or of midnight.

The gate only engages once both `process.json` and a today-dated `games.json`
parse; otherwise the run proceeds unthrottled, which is what bootstraps a new
day. The net effect is a handful of runs a day, not 1,440 — 2026-10-01 produced
four snapshot folders.

Backups are additionally skipped before 3 a.m. ET, to let any time-zone shift
pass first. The clock is `America/New_York` throughout, and day folders roll
over at ET midnight.

## The feeds

| Feed | Lands in | Notes |
| ---- | -------- | ----- |
| the schedule feed | `data/games.json` | only the first game-week entry, i.e. today |
| the pick-list feed | `data/helper.json` | keyed `"1"`, `"2"`, `"3"` |
| the player feed | `players/<id>.json` | one file per player |
| `bet1`–`bet4` | `data/bet1.json` … `bet4.json` | flat arrays of `{name, odds}` |

Player files are refreshed only when missing or when the player has changed
teams (`playerFileCurrent`, `public/fetch_lib.php`), so their season stats go
stale over a season unless the player is traded; current games and goals come
from the pick-list feed instead. `PLAYER_ID_OVERRIDES` covers pick-list entries
that arrive with a missing or wrong id.

`bet2`, `bet3` and `bet4` take an end-of-day cutoff and drop markets closing
after it. `bet1` takes none, so `bet1.json` can include tomorrow's games — worth
remembering when book coverage looks uneven.

`$savesrc` dumps each raw upstream response next to the parsed one. Cron never
enables it, and `fetch_service.php` hard-codes it to `false`.

## What lands on disk

```
data/
  games.json         today's schedule
  helper.json        today's three pick lists
  bet1..bet4.json    today's odds, one file per book
  process.json       run state: processed, started, warnings
  <Y-m-d>/
    games.json       that day's schedule
    <HHmm>/
      bet1..bet4.json
      helper.json
players/
  <id>.json
history/
  history.json       the index
  <season>_<date>_<format>.json
```

The `<HHmm>` subfolder is named for **the next upcoming game's ET start time,
not the clock** (`backup`, `public/fetch_lib.php`). Each folder therefore holds
the list and odds state as of just before that puck drop, which is what makes
the archive a usable record of each redraw. When no future game is left, nothing
is copied — that is the normal end-of-day state.

`process.json` carries the run state: `startRun` stamps `started` when a run
begins, and `processed` writes the finish time plus any warnings and clears
`started`. The front end reads it and shows a notice when the data is over a day
old, a run didn't finish, or the last run had warnings. Note that only the
manual Update action currently feeds that channel — `update.php` neither calls
`startRun` nor passes the steps' warnings into `backup`.

## The admin page

`fetch.php` sits in the site folder. It mints a CSRF token and posts credentials
to `fetch_service.php` with one of two actions:

- **Update** — the same sequence cron runs, with no throttling. A manual
  force-refresh.
- **History** — the only thing that ever writes `history/`.

Credentials live in `auth.json` (a name plus a bcrypt hash). `auth.json` is
gitignored, and it is rewritten in place when the hash is upgraded. The seeder
that writes it (`seed.html` and `seed_service.php`) runs on a local dev server
only and is never deployed.

## The history archive

`$datesTotal` in `fetch_service.php` is the season range table — one row per
season and format, with `start` and `end` dates. The 2026-27 regular season
starts 2026-09-29, the season opener.

The index at `history/history.json` is that table with a `files` array appended
per range, and fetching is incremental:

- Ranges appended since the last run are processed in full.
- Only the **last stored range** is checked for extension. If its stored `end`
  differs from the table's, the fetch resumes from the day after the stored one.
- File lists already fetched are carried forward untouched.

Two consequences worth knowing before editing that table:

- **Set `end` to the last completed day, never to today.** The history feed
  returns 404 for an unfinished day, and the index then records that day as
  done and never refetches it. If a live index already holds a range that starts
  later than the days you need, that entry has to be removed before the earlier
  days can be fetched.
- The scheme is append-only and positional. Inserting or reordering rows, or
  editing a range that is not the last one, misaligns the carried-forward file
  lists without refetching anything.

## Build and deploy

On the server, in the repo checkout: pull, `npm install` if dependencies
changed, then `npm run build`. Then copy, in this order:

1. `dist/assets/*` into the live folder, and **after that** `dist/index.html`.
2. Any changed PHP: `public/*` into the live folder, `update.php` into the
   update folder. The seeder files stay local — they are not deployed.

PHP changes only take effect once copied — the cron loads `fetch_lib.php` from
the live folder, not from the checkout.

**Never copy `dist/data`, `dist/history`, `dist/players` or `dist/auth.json`.**
The build copies all four out of the checkout's own stale `public/`, while the
server owns the live versions: cron writes `data/` and `players/`, `history/` is
built by the History action, and `auth.json` is rewritten in place on rehash.
Copying `dist/` wholesale overwrites the live history index.

`/commit` prints this copy list for a batch, computed from the diff since the
last pushed version commit.

## Front-end source map

| File | Role |
| ---- | ---- |
| `src/dataProcessor.ts` | loads and validates the feeds, matches player names across books, de-vigs |
| `src/picksOptimizer.ts` | the scoring functions, the historical audit, the live recommender (`bestPicks`), and the simulation that generates the correlation table |
| `src/statsCalculations.ts` | builds the Stats popup text and the row badges |
| `src/strategySelection.ts` | classifies a ticket's game-sharing shape and keeps all tied candidates |
| `src/teamGoals.ts` | expected team goals from team-total markets |
| `src/correlationData.ts` | generated lookup table, no logic |
| `src/dataTypes.ts` | strategies, combo patterns, book keys, pool slots |
| `src/components/` | `Table.tsx` (data model plus the games and odds tables), `Popup.tsx`, `CollapsibleSection.tsx`, `Settings.tsx`, `StatsPopupContent.tsx`, `InfoPopupContent.tsx`, `Correlate.tsx` |

## Feature flags and release checks

`src/features.ts` holds five flags; three are currently off. `correlation` is
on, and `analyze` selects between generating the correlation table, logging
correlations, and off.

Two of them are release gates that the `/commit` scan checks: `analyze` must be
`'OFF'`, and `$savesrc` in `fetch_service.php` must be `false`. The scan also
flags any history `end` date at or after today, for the reason given above.
