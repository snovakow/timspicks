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

Cron fires every minute, but `update.php` throttles itself. Its constants are an
update period of one hour, a retry period of five minutes, and a buffer of 60
seconds:

- No updates between the day's last game and midnight.
- Otherwise update once per period, or as soon as a game start time has passed
  since the previous run.
- Never within the buffer of a game start time, or of midnight.
- Inside the game window, a run that failed or a list the feed hadn't redrawn
  yet waits only the retry period.

Only the midnight buffer is checked on its own, before anything reads
`games.json`. The rest of the gate needs both `process.json` and a today-dated
`games.json` to parse, and at rollover `games.json` still holds yesterday's
schedule — so a check that waited on it would be skipped at exactly the minute
the upstream feeds are least likely to answer with JSON. The unthrottled
fall-through that remains is what bootstraps a new day; a failed run still waits
the full period while the window is unknown, or a rollover that can't reach the
schedule feed would retry every minute.

The retry period runs from an hour before the first game, and the last-game rule
caps its other end. That is where a missed pull is expensive: the live list stays
wrong until the next run, and the snapshot folder for the upcoming slot never
gets written — a last-slot one can't be recovered afterwards. Outside the window
a failure only costs hour-old odds, so it waits the hour.

A list the feed hadn't redrawn yet is recognised from its own contents. The feed
drops a team once its game starts, so a listed team whose game has already
started means the stored list predates that redraw. The check reads `games.json`
and `helper.json` and keeps no state, so it clears itself as soon as a pull lands
with the new draw, and it ignores games whose `gameScheduleState` isn't `OK` so a
postponed start time can't trigger it.

The other way a list goes stale is at rollover. Nothing runs from the day's last
game until midnight, so the final draw is still in `helper.json` when the first
run after midnight fetches. If the feed hasn't posted the new day's first draw by
then, that run saves yesterday's final list against today's schedule. The feed
stamps each draw with `dateTimeAvailable`, in ET with no offset, and the day's
first draw is stamped midnight. `updatePicks` keeps that stamp in `helper.json`,
and a stamp dated other than today marks a list left over from an earlier day.
Such a list also retries on the retry period, but only in the hour after
midnight; after that hour it goes back to the update period, so on a day the feed
never posts, the cron doesn't pull every five minutes until the last game. The
app runs the same check against `games.json`'s date and reports that today's
lists haven't posted yet. A `helper.json` written before the stamp was kept
counts as current.

The net effect is roughly hourly, plus a run shortly after each game start —
about two dozen a day, not 1,440, with a floor of one per retry period while a
list is stale or a feed is failing inside the window. Fewer snapshot folders
than that appear, since
each is named for the next upcoming game and every run before that puck drop
overwrites it: the folder count tracks game slots, not runs. 2026-10-01 produced
four.

Backups are additionally skipped before 3 a.m. ET, to let any time-zone shift
pass first — times are stored in local time, so a shift could misname a day
folder or its game-time subfolder. Three hours of real time added to local
midnight lands past the shift either way: 4 a.m. EDT in March, 2 a.m. EST in
November. The clock is `America/New_York` throughout, and day folders roll over
at ET midnight.

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

Every fetch goes through `fetchCurl` or `fetchUrl`, which reject a non-2xx status
or an empty body before anything parses them — otherwise an outage reaches
`json_decode` and is reported as "Error decoding JSON", which is what a feed
mid-rollover used to look like. The exception is page 1 of `bet4`, where an
unreachable feed has always counted as "no offers today"; it still does, but it
records a warning now instead of passing for a quiet day.

The History fetch tolerates one status of its own: a 404 means the challenge
didn't run that day, so it is skipped as before. Every other failure stops the
range, because an error envelope parses as JSON and would otherwise be saved as
that day's history, with the day recorded as fetched for good.

`$savesrc` dumps each raw upstream response next to the parsed one. Cron never
enables it, and `fetch_service.php` hard-codes it to `false`.

## What lands on disk

```
data/
  games.json         today's schedule
  helper.json        today's three pick lists
  bet1..bet4.json    today's odds, one file per book
  process.json       run state: processed, started, failingSince, warnings
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
old, a run didn't finish, a game has started since the last run, or the last run
had warnings. A run that dies partway, including one whose snapshot copy fails,
leaves `started` behind, and the next cron attempt measures its wait from it.

Each attempt restamps `started`, and inside the game window failures retry every
five minutes, so `started` alone would never age past the banner's ten-minute
grace while a feed kept failing. When `startRun` finds an unfinished `started`,
it keeps the earliest one as `failingSince`, and the banner times its grace from
that. `processed` clears both.

The game-started notice is the app's own check rather than something the cron
records: it compares the day's start times against `processed`, so it still fires
when the cron has stopped running altogether — the one failure nothing
server-side can report. It has a ten-minute grace of its own, since no pull is
possible until the game start buffer clears and a stale list can take a retry
period beyond that; a shorter grace would light the banner after every puck
drop. It also leaves out the day's last start: the cron does no updates between
the last game and midnight, so no pull ever follows that start, and counting it
would light the banner every night until the first run after midnight.

That window gets a state of its own instead. Once the day's last start has passed
the app says every game has started, and clears the games table and the three
pick lists — the lists it holds are the final draw, which can no longer be
played, and leaving them up reads as picks still to make. It flips on the clock
rather than on a fetch, so a page left open switches over by itself at the last
puck drop; a long wait is re-armed from the clock each time, since a background
tab throttles its timers and a sleeping device wakes with one already due. There
is no re-fetch to go with it: the next day's lists arrive on the next load, by
which time the post-midnight run has written them. Data stale enough to trip the
over-a-day notice is likely holding an earlier day's schedule, whose last start
is long past, so that notice takes precedence over calling the day locked.

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

`src/features.ts` holds the build-time feature flags; read the file for which
are on. A flag gates its feature end to end, so turning `correlation` off also
hides the strategy dots, the Pick Strategies settings, the correlation slider
and the Legend button. `analyze` is the odd one: rather than on and off, it
selects between generating the correlation table, logging correlations, and off.

Two settings are release gates that the `/commit` scan checks: `analyze` must be
`'OFF'`, and `$savesrc` in `fetch_service.php` must be `false`. The scan also
flags any history `end` date at or after today, for the reason given above.
