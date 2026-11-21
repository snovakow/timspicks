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
* * * * * curl -sS "<update-host>/update.php?lib=<site-folder>" >> timspicks_log.txt
```

`crontab -l` lists what is installed. The log is append-only, and a run emits at
most one line. `-sS` keeps curl's progress meter off stderr, which cron would
otherwise mail on every call, while still letting curl's own errors through.

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
- A day the schedule lists no games is done once a run has its schedule.

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

A day the schedule lists no games has no draw at all, and the pick-list feed
answers it with an error rather than a list. So the run that fetches such a day's
schedule ends there, complete, without the pick lists or the books, and no other
run follows until midnight. The lists and odds from the last day with games stay
on disk, and the page shows none of them, only that there are no games.
That is the whole of a day without games, not a failure.

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

### The scores step

One step sits outside all of the above. Goals come in while no run is due, and
after the day's last start no run comes at all, so the update script fetches
scores on every call, ahead of the gate, and only while a game is in play: from
its start until the score feed calls it official. That comes some time after the
game ends, so a goal credited to another player on review still lands. A game the
feed never calls official is followed for a fixed time after its start and then
dropped, and a game off its normal schedule isn't followed at all.

Each day's scores go in a file in that day's folder, which only that day's fetch
writes, so a later day can never replace them. The step looks at yesterday as
well as today, so games still going at midnight are seen through, and no game is
followed long enough to reach further back. Until a day's first fetch, whether
its games are in play comes from its schedule: the schedule file while it holds
that day, then the copy its snapshots saved. The admin page's Update fetches
today's scores even with nothing in play, unless the schedule lists no games for
today, yesterday's only while one of its games still is, and any earlier day the
archive lacks (see the archive, below).

The step is no part of a run. It writes no log line and leaves the run state
alone, and a failed fetch, or a reply that isn't the day asked for, leaves that
day's file as it was, so a failure costs only that minute's scores. The file
carries the time it was last written, which is the only trace of a feed that has
stopped answering.

## The feeds

| Feed | Lands in | Notes |
| ---- | -------- | ----- |
| the schedule feed | `games.json` | only the first game-week entry, i.e. today |
| the pick-list feed | `helper.json` | keyed by the feed's own list ids |
| the player feed | `players/<id>.json` | one file per player |
| the roster feed | `rosters.json` | the skaters on each of today's teams, fetched once a day per team; a reply with no skaters counts as failed |
| the score feed | `<Y-m-d>/scores.json` | the day's season and format, and each of its games with its state and the players with a goal; see the scores step above |
| each book | `data/bet1.json`, `bet2.json` and on | flat arrays of player names and odds |

Player files are refreshed only when missing or when the player has changed
teams, so their season stats go stale over a season unless the player is traded;
current games and goals come from the pick-list feed instead. An override table
covers pick-list entries that arrive with a missing or wrong player id.

The books price players by name alone, so the rosters give the page each name's
team, which lets the player table show every player on today's teams that the
books price, outside the lists as well. The schedule step fetches them, once a day
per team. A team whose roster fails, by an error, a reply that doesn't decode or
one that lists no skaters, is left out and fetched again on the next run, so an
empty roster is never kept for the day. Every missing team is fetched at once
under a short time limit: the step runs ahead of the lists and the books on every
run, and a roster feed that hangs mustn't hold the run up. A run's roster
failures, a failed save included, make one warning, with the teams grouped by
reason, so an outage is one line in the banner rather than one per team, and like
every warning it leaves out the addresses the errors held.

Since the books go by name, a player outside the lists who shares his name with
another of the day's players is left out of the player table, as a book's price
for that name could be either's. Players a table of the books' spellings by player
id tells apart are the exception.

### The books

The books are kept in one list beside the scraping library. Its order is the
order the page shows them in, and it gives each book a mode:

- **direct** reads the book's own site.
- **comparison** reads the book's prices off an odds-comparison page instead,
  which shows every book's prices for a game in one place, in the region the list
  gives that book. It serves a book whose own site refuses the scraper, or one the
  scraper has no reader for.
- **off** leaves the book alone: it isn't fetched, its file isn't touched or copied
  into snapshots, and the page doesn't show it.

The front end is built from the same list, so switching a book between direct and
comparison needs only the list copied to the live folder, while turning a book off
or back on needs a build as well.

The comparison pages are fetched once per game and region, whichever books share
them, and only for games that haven't started: the books take a game's player
markets down at puck drop, and a started game's page would hold live prices. They
spell names their own way, so every book in comparison mode shares those
spellings. On 2026-10-29 their prices matched the books' own for 94–99% of
players, and the rest differed by a step or two, as a page a few minutes behind
the book would.

Asked for a day without games, the matchups page shows the nearest day that has
some, and those games haven't started either, so their prices would pass for
today's. Its games count only when it shows today. A day the schedule lists no
games for leaves the comparison books empty without a warning, as the books read
from their own sites are; a page without today's games on any other day is a
warning, since its layout may have changed.

Read from their own sites, bet2, bet3 and bet4 take an end-of-day cutoff and drop
markets closing after it. bet1's site takes none, so in direct mode its file can
include tomorrow's games — worth remembering when book coverage looks uneven.

Coverage can also go missing without any error. A book that changes its format
still parses, into an empty file or into prices from the wrong market, and a
player whose name a book spells differently from the pick-list feed gets no
price from that book in the app. `/health-odds` looks for both in a fresh pull
of every book, and fixes them in the name mappings or the parser.

Every fetch rejects a non-2xx status or an empty body before anything parses it —
otherwise an outage reaches the JSON parser and is reported as a decode error,
which is what a feed mid-rollover used to look like.

A book that fails, by an error or by throwing, doesn't stop the run, and the
failure becomes a warning. The site's banner shows warnings to visitors, so one
names the book as the page does and leaves out the addresses and server paths
the error held. Prices the book gave earlier the same day (ET) stay in its file,
so the page keeps showing them. A file from an earlier day is written empty
instead, since it holds another day's games, and the snapshot then keeps the
slot's earlier copy (see below). In comparison mode, a page that fails fails every
book that needed it. The run still completes, so it waits the full period like
any other, even inside the game window. The pick list, the schedule and the book
list still stop the run, as does a book file that can't be written.

A debug switch can dump each raw upstream response next to the parsed one. Cron
never enables it and the service hard-codes it off; leaving it on in a deploy is
one of the release gates.

## What lands on disk

```
data/
  games.json         today's schedule
  helper.json        today's three pick lists
  rosters.json       today's teams' skaters, for the player table
  bet1.json ...      today's odds, one file per book the list shows
  process.json       run state
  days.json          the archive's index: each day with a snapshot and final scores
  <Y-m-d>/
    games.json       that day's schedule
    scores.json      that day's season and format, game states and goal scorers
    <HHmm>/
      bet1.json ...
      helper.json
      backfill.json  the books whose prices here were filled in later, if any
players/
  <id>.json
```

The `<HHmm>` subfolder is named for **the next upcoming game's ET start time, not
the clock**. Each folder therefore holds the list and odds state as of just
before that puck drop, which is what makes the archive a usable record of each
redraw. When no future game is left, nothing is copied — that is the normal
end-of-day state.

A book that comes back completely empty doesn't replace a copy the folder already
holds. Without that, a feed that drops its market partway through the day would
wipe the last prices the slot captured. The kept file is older than the rest of
its folder, which is the trace that it happened. A snapshot copy also keeps each
book file's own time, so prices a failed book kept from an earlier run show their
real age in the folder too.

Prices filled in after the fact, from closing lines, look like any other book file,
so a folder that holds some marks them in its backfill file, by book. A closing
price knows late news, such as a scratch, that a price captured before the game
didn't, so any analysis that compares books, or prices over time, has to be able
to tell the two apart.

The run-state file carries when a run began, when it last finished, and any
warnings it raised. The front end reads it and shows a notice when the data is
over a day old, a run didn't finish, a game has started since the last run, or
the last run had warnings. On a day the schedule lists no games the page says
only that, with no notice, since none of them applies. A run that dies partway,
including one whose snapshot copy fails, leaves its start stamp behind, and the
next cron attempt measures its wait from it.

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
the app says every game has started, and clears the games table, the three pick
lists, the player table and the stats view built from them. Before that, each
start takes its game out of the games table and its players out of the pick lists
and the stats — a started game can no longer be played, and its players left in
read as picks still to make. This runs on the clock rather than on a fetch, so a
page left open drops each game by itself at its puck drop and locks at the last; a
long wait is re-armed from the clock each time, since a background tab throttles
its timers and a sleeping device wakes with one already due. There is no re-fetch
to go with it: the next day's lists arrive on the next load, by which time the
post-midnight run has written them. So a page left open keeps the lists it loaded
with, while with today's history on a passed slot's snapshot is fetched when the
clock passes it, and can hold a newer draw than the page's lists; today's history,
below, says what the page does then. Data stale enough to trip the over-a-day
notice is likely holding an earlier day's schedule, whose last start is long past,
so that notice takes precedence over calling the day locked or dropping its games.

The app reads every game of the day, started or not, and leaves the choice to the
clock: a run can land after a start but before the feed redraws, and its lists
still hold that game's players.

Today's history is a setting. With it on, a started game and its players stay in
the tables greyed out, never highlighted and still left out of the stats, and the
locked day keeps its tables. Each started game's players come from its slot's
snapshot folder, the last lists before it started, in place of any the current
lists still hold, since a run after the start finds that game's prices changed,
or gone. A player an earlier slot held in a list, and a later redraw dropped from
it, stays in that table too, greyed and out of the stats like a started game's,
with his prices from the latest slot that still held him.

On a page left open, a slot that started after the load can hold a newer draw than
the page's own lists, and the newest such slot is the latest draw the page knows.
A player it holds in a list, whose game hasn't started, was not dropped, so no
slot greys him there. He is left out of that table rather than shown live, as the
page's own lists leave him out: a live row is one the stats count, so showing him
would give the stats a player with the history on that they lack with it off. He
appears on the next load, which fetches that draw. A slot that started after the
load greys only players whose games have started, since against the page's older
lists a player a later draw dropped looks the same as one it added.

The player table, which holds every player on today's teams that the books price,
to judge who could come up in a later draw, takes a started game's players from
its slot's snapshot the same way, and keeps a player a redraw dropped live, with no
list. It shows each player once, with his list where one holds him, even where the
lists and the rosters set him in different games. The stats view lists
each passed slot with its top picks' Streak, opening to the slot's full stats
from the books selected, and once the day's last start has passed it shows only
those slots.

Today's history also marks each player's result, at the end of his name: a check
once he has scored, a cross once his game has ended without a goal from him, and
nothing until then. The marks come from the day's scores file, which the page
reads once a game has started, while the history is on or the my-picks table,
described below, shows the day's picks, and again as often as the cron rewrites it
while the page is in view and a game is in play, so they follow the games without
a reload. Only goals the contest counts are marked, so a shootout goal isn't one.
The score feed lists a shootout's deciding goal with the rest, and the scores
step leaves it out.

With the My Picks setting on, a player's name in each of the three pick
tables also marks his row as the pick entered in the contest's own app: one row a
table, moved by marking another and cleared by marking it again. The setting
stands apart from the history, which only adds rows to mark: a started game's and
a dropped player's, since a pick can be recorded late. The mark changes no
highlight and no stat, and the player table takes none. While the lists are an
earlier day's, before the day's first draw has posted, the names mark nothing, so
no mark goes to a player the real lists may not hold. With the setting off, which
lasts the page's life like the other settings, the names mark nothing and no mark
or my-picks table shows, and nothing is deleted.

The marks are the one thing the page keeps between loads. They sit in the
browser's local storage under one key, by the schedule's ET date, each with the
player's id, name, team and logos, which is all a mark needs once that day's lists
are gone. Nothing is sent to the server. What is read back is checked like any
feed, and a browser that refuses storage keeps the marks for the life of the page.
Only the latest days are kept, enough for the one the my-picks table shows and
the one before it, which shows again if the later day's marks are all cleared.

The marked picks are also listed in a table of their own above the games, each
with its goal mark and its game's start time, with the history on or off. It
holds the latest day's with a mark: the loaded day's once one is marked, and
until then an earlier day's, however many of the loaded day's games have
started, titled as yesterday's or, when older, by its date. The next day's lists
arrive on the first load after midnight and a late game can still be going then,
so a day's results stay up until the next day's picks are made. The loaded day's
start times come from its schedule. An earlier day's come from its own scores
file, as do its results, followed from the starts the file gives, as the page
holds no schedule for that day. The table is a section like the others,
collapsed by its title, and the setting alone turns the marking and the table
off.

## The admin page

An admin page sits in the site folder. It mints a CSRF token and posts
credentials to the scraping service to run **Update**: the same sequence cron
runs, with no throttling, which on a day without games ends after the schedule
and the scores. It is a manual force-refresh, and the way to fill in an
archived day the cron missed (see the archive, below).

Credentials live in a gitignored file holding a name and a bcrypt hash, and it is
rewritten in place when the hash is upgraded. The seeder that writes it runs on a
local dev server only and is never deployed.

## The archive

The archive is each day's slot snapshots and scores file, kept for good, and it is
what the app's archive replays and `/analyze` measure. The scores file records the
day's season and whether it was a regular-season or a playoff day, as the score
feed gives them. The archive's index lists every day whose folder holds a snapshot
and whose scores are final: every game called official, or off its normal
schedule. A day only ever joins whole, so a replay never reads a game still in
progress or a goal still under review.

Nothing has to be run by hand to keep it current. The fetch that finds a day's
last game official rebuilds the index, so a day joins as its games end. Every
Update from the admin page rebuilds it too, from the day folders alone, so any
rebuild puts right whatever an earlier one missed.

The one gap the cron can't close is a day it missed while the games were on: the
machine asleep, say, or the score feed down until the games were no longer
followed. That day keeps its snapshots but has no final scores, so it stays out of
the archive. The score feed keeps every past day, so Update fetches each earlier
day like that again, a few at a time so that one Update stays inside the web
server's time limit, and `/health-server` lists the days still missing.

The replays score each listed player against that day's scorers by player id, and
take his opponent from the day's games. So a list entry with a wrong id reads as a
miss, as it does in the page's goal marks, and one whose team had no game on its
schedule that day is left out. A snapshot whose lists were drawn on an earlier day,
which happens when the day's first draw posts late, is left out too, since that
day's results say nothing about those lists.

Until 2026-11-20 the archive's results came from the pick-list site's own history,
fetched by a separate admin action over a hand-kept table of season dates. Checked
that day against all 103 of its days, the score feed gave the same result, team,
opponent, season and format for every listed player, so the earlier days were
fetched again from the score feed and the second source was retired.

## Getting a change live

[Deploying](deployment.md) has the steps. Two properties of the arrangement are
worth understanding before following them.

The built front end is copied into the live folder, so the live site is a copy
and not the checkout itself. PHP is copied the same way and changes nothing
until it is: cron loads the scraping library out of the live folder, never out
of the checkout.

A build made in the checkout also fills the data, players and credentials paths
from its own stale copies, while the server owns the live ones — cron writes the
data and players folders, the archive among them, and the credentials file is
rewritten in place on rehash. So those three are never copied, and copying the
build output wholesale rolls the live archive back to the checkout's.

## Feature flags and release checks

The app has a handful of build-time feature flags; read their file for which are
on. A flag gates its feature end to end, so turning correlation off also hides
the strategy dots, the strategy settings, the correlation slider and the Legend
button. One flag is not a simple on and off: it selects between fitting the
correlation lifts, logging them alongside an analysis of the picks, and doing
neither.

A few settings have to hold a particular value before a build is safe to ship,
and `/commit` checks each of them. [Deploying](deployment.md) lists them, since
following them is a deploy step rather than something to know about the app.
