# The app and the server

How the pieces are wired, what ends up on disk, and how a change reaches the
live site. Exact hosts and paths are deliberately left out; "the live folder"
and "the update folder" stand in for them, the same way the `/commit` scan
reports them.

## Layout

Two sibling trees:

- **the site folder** — the built front end plus the PHP that scrapes and
  serves. In this repo it is the public folder; on the server it is the live
  folder.
- **the update folder** — the cron entry point, in its own tree in the repo and
  its own folder on the server.

The update script takes a query parameter naming which site folder to drive. It
loads the scraping library out of that folder, one level up from itself, and
writes into that same folder's data and players folders. So a single update
script can drive more than one site folder — a local one and the live one — by
varying the parameter. Cron runs it every minute, with the host elided here:

```
* * * * * curl "<update-host>/update.php?lib=<site-folder>" >> timspicks_log.txt
```

`crontab -l` lists what is installed. The log is append-only, and a run emits at
most one line.

The build emits relative asset and data URLs rather than absolute ones. That is
what lets the same build run from a subfolder.

## Cadence: not once a minute

Cron fires every minute, but the update script throttles itself. It works from
three spans: an update period, a much shorter retry period, and a small buffer
around moments when a fetch would be pointless.

- No updates between the day's last game and midnight.
- Otherwise update once per period, or as soon as a game start time has passed
  since the previous run.
- Never within the buffer of a game start time, or of midnight.
- Inside the game window, a run that failed or a list the feed hadn't redrawn
  yet waits only the retry period.

Only the midnight buffer is checked on its own, before anything reads the
schedule file. The rest of the gate needs both the run state and a today-dated
schedule to parse, and at rollover the schedule file still holds yesterday's — so
a check that waited on it would be skipped at exactly the minute the upstream
feeds are least likely to answer with JSON. The unthrottled fall-through that
remains is what bootstraps a new day; a failed run still waits the full period
while the window is unknown, or a rollover that can't reach the schedule feed
would retry every minute.

The faster retry spans the game window, from shortly before the first game until
the last, and that is where a missed pull is expensive: the live list stays wrong
until the next run, and the snapshot folder for the upcoming slot never gets
written — a last-slot one can't be recovered afterwards. Outside the window a
failure only costs staler odds, so it waits the full period.

A list the feed hadn't redrawn yet is recognised from its own contents. The feed
drops a team once its game starts, so a listed team whose game has already
started means the stored list predates that redraw. The check reads the schedule
and the pick lists and keeps no state, so it clears itself as soon as a pull
lands with the new draw, and it ignores games whose schedule state is abnormal so
a postponed start time can't trigger it.

The other way a list goes stale is at rollover. Nothing runs from the day's last
game until midnight, so the final draw is still stored when the first run after
midnight fetches. If the feed hasn't posted the new day's first draw by then,
that run saves yesterday's final list against today's schedule. The feed stamps
each draw with the time it was drawn, in ET with no offset, and the day's first
draw is stamped midnight. The scraper keeps that stamp alongside the lists, and a
stamp dated other than today marks a list left over from an earlier day. Such a
list also retries on the retry period, but only for a while after midnight; after
that it goes back to the update period, so on a day the feed never posts, the
cron doesn't pull every few minutes until the last game. The app runs the same
check against the schedule's date and reports that today's lists haven't posted
yet. A stored list written before the stamp was kept counts as current.

The net effect is one run per update period plus one shortly after each game
start, with a floor of one per retry period while a list is stale or a feed is
failing inside the window — nowhere near the 1,440 times a day cron fires. Fewer
snapshot folders than runs appear, since each is named for the next upcoming
game and every run before that puck drop overwrites it: the folder count tracks
game slots, not runs. On 2026-10-03, a full day, 23 runs left five folders.

Backups are additionally skipped for the first few hours after local midnight, to
let any time-zone shift pass first — times are stored in local time, so a shift
could misname a day folder or its game-time subfolder. Enough hours of real time
added to local midnight lands past the shift either way, in both the spring and
the autumn direction. The clock is Eastern throughout, and day folders roll over
at ET midnight.

## The feeds

| Feed | Lands in | Notes |
| ---- | -------- | ----- |
| the schedule feed | `games.json` | only the first game-week entry, i.e. today |
| the pick-list feed | `helper.json` | keyed by the feed's own list ids |
| the player feed | `players/<id>.json` | one file per player |
| bet1–bet4 | `data/bet1.json` … `bet4.json` | flat arrays of player names and odds |

Player files are refreshed only when missing or when the player has changed
teams, so their season stats go stale over a season unless the player is traded;
current games and goals come from the pick-list feed instead. An override table
covers pick-list entries that arrive with a missing or wrong player id.

bet2, bet3 and bet4 take an end-of-day cutoff and drop markets closing after it.
bet1 takes none, so its file can include tomorrow's games — worth remembering
when book coverage looks uneven.

Every fetch rejects a non-2xx status or an empty body before anything parses it —
otherwise an outage reaches the JSON parser and is reported as a decode error,
which is what a feed mid-rollover used to look like. The exception is the first
page of bet4, where an unreachable feed has always counted as "no offers today";
it still does, but it records a warning now instead of passing for a quiet day.

The History fetch tolerates one status of its own: a 404 means the challenge
didn't run that day, so it is skipped as before. Every other failure stops the
range, because an error envelope parses as JSON and would otherwise be saved as
that day's history, with the day recorded as fetched for good.

A debug switch can dump each raw upstream response next to the parsed one. Cron
never enables it and the service hard-codes it off; leaving it on in a deploy is
one of the release gates.

## What lands on disk

```
data/
  games.json         today's schedule
  helper.json        today's three pick lists
  bet1..bet4.json    today's odds, one file per book
  process.json       run state
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

The `<HHmm>` subfolder is named for **the next upcoming game's ET start time, not
the clock**. Each folder therefore holds the list and odds state as of just
before that puck drop, which is what makes the archive a usable record of each
redraw. When no future game is left, nothing is copied — that is the normal
end-of-day state.

The run-state file carries when a run began, when it last finished, and any
warnings it raised. The front end reads it and shows a notice when the data is
over a day old, a run didn't finish, a game has started since the last run, or
the last run had warnings. A run that dies partway, including one whose snapshot
copy fails, leaves its start stamp behind, and the next cron attempt measures its
wait from it.

Each attempt restamps the start, and inside the game window failures retry
quickly, so the start stamp alone would never age past the banner's grace while a
feed kept failing. So when a run finds an unfinished start stamp, it keeps the
earliest one as the moment the failing streak began, and the banner times its
grace from that. A finished run clears both.

The game-started notice is the app's own check rather than something the cron
records: it compares the day's start times against the last finish, so it still
fires when the cron has stopped running altogether — the one failure nothing
server-side can report. It has a grace period of its own, since no pull is
possible until the game start buffer clears and a stale list can take a retry
period beyond that; a shorter grace would light the banner after every puck drop.
It also leaves out the day's last start: the cron does no updates between the last
game and midnight, so no pull ever follows that start, and counting it would
light the banner every night until the first run after midnight.

That window gets a state of its own instead. Once the day's last start has passed
the app says every game has started, and clears the games table and the three
pick lists — the lists it holds are the final draw, which can no longer be
played, and leaving them up reads as picks still to make. It flips on the clock
rather than on a fetch, so a page left open switches over by itself at the last
puck drop; a long wait is re-armed from the clock each time, since a background
tab throttles its timers and a sleeping device wakes with one already due. There
is no re-fetch to go with it: the next day's lists arrive on the next load, by
which time the post-midnight run has written them. Data stale enough to trip the
over-a-day notice is likely holding an earlier day's schedule, whose last start is
long past, so that notice takes precedence over calling the day locked.

## The admin page

An admin page sits in the site folder. It mints a CSRF token and posts
credentials to the scraping service with one of two actions:

- **Update** — the same sequence cron runs, with no throttling. A manual
  force-refresh.
- **History** — the only thing that ever writes the history folder.

Credentials live in a gitignored file holding a name and a bcrypt hash, and it is
rewritten in place when the hash is upgraded. The seeder that writes it runs on a
local dev server only and is never deployed.

## The history archive

The scraping service holds the season range table — one row per season and
format, with a start and an end date. The 2026-27 regular season starts
2026-09-29, the season opener.

The history index is that table with a file list appended per range, and fetching
is incremental:

- Ranges appended since the last run are processed in full.
- Only the **last stored range** is checked for extension. If its stored end
  differs from the table's, the fetch resumes from the day after the stored one.
- File lists already fetched are carried forward untouched.

Two consequences worth knowing before editing that table:

- **Set the end to the last completed day, never to today.** The history feed
  returns 404 for an unfinished day, and the index then records that day as done
  and never refetches it. If a live index already holds a range that starts later
  than the days you need, that entry has to be removed before the earlier days
  can be fetched.
- The scheme is append-only and positional. Inserting or reordering rows, or
  editing a range that is not the last one, misaligns the carried-forward file
  lists without refetching anything.

## Getting a change live

[Deploying](deployment.md) has the steps. Two properties of the arrangement are
worth understanding before following them.

The built front end is copied out of the checkout into the live folder, so the
live site is a copy and not the checkout itself. PHP is copied the same way and
changes nothing until it is: cron loads the scraping library out of the live
folder, never out of the checkout.

The build also fills the data, players, history and credentials paths from the
checkout's own stale copies, while the server owns the live ones — cron writes the
data and players folders, the History action builds the archive, and the
credentials file is rewritten in place on rehash. So those four are never copied,
and copying the build output wholesale overwrites the live history index.

## Feature flags and release checks

The app has a handful of build-time feature flags; read their file for which are
on. A flag gates its feature end to end, so turning correlation off also hides
the strategy dots, the strategy settings, the correlation slider and the Legend
button. One flag is not a simple on and off: it selects between generating the
correlation table, logging correlations, and doing neither.

A few settings have to hold a particular value before a build is safe to ship,
and `/commit` checks each of them. [Deploying](deployment.md) lists them, since
following them is a deploy step rather than something to know about the app.
