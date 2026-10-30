---
name: health-odds
description: Check that every book in the book list still parses into anytime goal scorer odds, from its own site or from the comparison pages as its mode sets, and that every listed player's name finds his odds in each book. Pulls the books fresh through this checkout's parser, traces every parsed entry to the raw market it came from, compares prices across the books and against the live files, and runs the app's own name matchers over today's pick lists and the season's snapshots. Then fixes what it finds, in oddsNameMap or, when a book's format has changed, in the parser. Use when asked to check the sportsbooks or their parsing, whether the odds are anytime scorer odds, or why a player shows no odds from a book.
argument-hint: "[--days N | --all] [--direct] [--no-pull --out <dir>]"
model: opus
effort: max
allowed-tools: Read, Grep, Glob, Edit, Bash(node .claude/skills/health-odds/scripts/odds.mjs:*), Bash(npx tsc -b), Bash(npx eslint:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(ls:*), Bash(cmp:*), Bash(diff:*)
---

# Odds feed health

Arguments: $ARGUMENTS

This skill runs in this checkout, on the machine that serves the site, like health-server. It checks two things, then fixes what it finds:
- **Parsing.** Each book's parser in `public/fetch_lib.php` still reads the anytime goal scorer market, all of it, and nothing else: its own site's fetcher (`fetchBet1`–`fetchBet4`) for a book in direct mode, or the comparison parser (`comparisonPrices`) for one in comparison mode. The book list, `public/sportsbooks.json`, sets each book's mode. A book or a page can rename or reshape that market without any error. The parser then writes an empty or partial list, or another market's prices, and the site carries on.
- **Names.** Every listed player finds his price in each book that prices his game. A book that spells him differently from the roster drops out for him silently, on the site and in the archive replays.

It may change `oddsNameMap` in `src/dataProcessor.ts`, and the book parsers in `public/fetch_lib.php` when a format changed. Never:
- copy, deploy, move or delete anything in the live or update folders, or write to `data/`, `players/`, `history/` or `auth.json` anywhere
- request `update.php`, `fetch_service.php` or `fetch.php` over HTTP
- edit `src/correlationData.ts`, which the user regenerates
- commit: the user commits, and `/commit` reviews the batch

A pull makes a few dozen requests to the books and the comparison pages, the same ones the cron makes every hour. Pull once per run, and re-check that pull with `--no-pull`.

The repo is public. Keep hosts and server paths out of everything tracked. Comments state the rule, not the case that prompted it, so no book key, date or game. The one exception is a name-map line, which ends with the books that use its spelling, as bet keys (`// bet2 bet4`), never as book names (the commit skill, step 3).

## 1. Run the check

If this checkout is on `main`, ask before changing anything, because work lands on `development`. Then:

    node .claude/skills/health-odds/scripts/odds.mjs --out <new folder> $ARGUMENTS

- `--out <dir>`: where the pull lands, which has to be new or empty. Use a new folder in the thread's scratchpad when there is one. Without it the script makes a temp folder and prints where.
- `--no-pull`: re-check what `--out` already holds, without requesting anything. It loads `src/` afresh, so it's the check to run after a name fix.
- `--direct`: pull each book that has a fetcher for its own site through it, whatever its mode. It shows whether a book moved to comparison mode answers directly again, without changing the live list. Use it now and then, not every run: a site that blocked the scraper on purpose shouldn't be hit often.
- `--days N` or `--all`: how far back the snapshot sweep reads. The default is this season, back to the off-season gap between snapshot days.
- `--lib <path>`: parse with another `fetch_lib.php`, and the book list beside it. The default is this checkout's `public/fetch_lib.php`. When the live folder's copy differs, the script pulls with that too, into `<out>/live-lib`, so both parsers get checked. A live copy from before the book list can't be pulled this way, and the report says so.
- `--live <dir>`, `--php <path>`: overrides for when discovery fails. The Setup section says which one it needs.

The script finds the live folder the way health-server does, from the cron line and the web server config. It runs PHP 8 from PATH, or the CLI beside the web server's own PHP. It lints the parser before pulling, and it catches the parser's notices rather than logging them, so a check never adds to the server's PHP error log. The name checks run the app's own code, loaded from `src/` through Vite. The Setup section says if that failed, and a check that can't load the app skips names rather than guess.

## 2. Reading the report

It opens with a verdict and an **Attention** list:
- **FAIL** means the site gets wrong odds or none, now or on the next run. That includes a parser that throws, a market that isn't the anytime one, prices the parser never read, and entries the app would reject.
- **WARN** means a book couldn't be checked, a finding to confirm, or a name to fix.

**Pull.** One line for the schedule, one for the books with each one's mode, then one per book.
- A book that fails, by an error or by throwing, shows as a warning, as the cron records it: the run carries on without that book's prices. An HTTP error or timeout means that book couldn't be checked this time. health-server shows whether the cron is failing on it too.
- In comparison mode, one failed page fails every book that needed it.
- Notices are often the first sign of a changed feed.

**Today's games.** The entries each book's parsed file holds for each game.
- A game that started before the pull is expected to be empty, because books take a game's player markets down at puck drop.
- Books post player markets at their own pace, so an empty book for an upcoming game is flagged only once two other books price it.
- If the book's raw response does price that game's anytime market, that's a FAIL: the parser missed it.

**Markets.** Each parsed entry is traced to the raw selection with the same name and price, so this shows what was actually read, not what the parser looks for.
- **Read** is the market the entries came from, with whatever the book states about how it settles (period, line, side), and the count per game against the prices that market holds. Expect one market per game, named as the anytime goal scorer market, settling on the whole game and on one or more goals, overtime included.
- **Left** lists the other player scorer markets in the responses, which the parser rightly ignores: first scorer, period markets, 2+ goals, parlays. One marked "anytime-like" is either a second copy of the market or the one the parser should now be reading.
- Entries that match no raw selection mean the parser reads something this check's reader doesn't, usually a new layout. Inspect the raw files.
- bet1's own site takes no end-of-day cutoff, so in direct mode its entries from games past today are expected there and nowhere else.
- A book in comparison mode is read off each game's odds tab, as the over on 0.5 goals: the report calls that market "Goals Scored, 1 or more goals". Only games that hadn't started are read.
- The anytime call is made from wording and stated terms. Confirm a FAIL, or an unfamiliar market name, in the raw file before acting on it.

**Prices.** Each book against the median of the others for the same players.
- Books price long shots differently, so single players spread widely.
- A whole book running well apart from the others is reading another market, or another odds format. The app reads every price as decimal odds.

**Live files.** The live book files from the cron's last run, against this pull.
- The same names at about the same prices mean the site serves what the parser reads now.
- An empty live file, or one that shares few names with the pull, means the cron's last run read something else. Check health-server, and the Setup line on whether the deployed `fetch_lib.php` differs; when it does, its own pull is compared under the table.

**Names, today's lists.** The live pick lists against this pull, through `compilePlayerList` itself: the roster name, then `oddsNameMap`, then the player file's language spellings. A player counts only for the books that price his game. Each miss lists the names in that book's odds for his game that could be his.

**Names, snapshots.** Each snapshot folder's lists against that folder's own odds, through both matchers:
- **The app's**, as above, with today's player files.
- **The archive replays'** (`oddsNameCandidates`): the pick-list name, then the map read both ways. These replays read every snapshot when the correlation table is generated and when the strategy audit runs. A miss here drops that book from both, even for a player the site finds.
- **Missing from one book while two others had him**, with nothing like his name there. Usually the book didn't list him, but a spelling too far off to spot ends up here too.

**Suggested entries.** One `oddsNameMap.set` line per lead, keyed the way its matcher looks names up, with the books as bet keys. Leads come from spelling likeness, so they include namesakes.

## 3. Confirm before changing anything

**A market.** Open the raw file the Markets section names, in `--out`, find the market, and read its own terms: the period, the line, which side, whether overtime counts. The name alone can mislead. For a game that went unread, find the market the book uses now and what makes the parser miss it: a renamed market, a new layout, or a moved field.

**A name.** Make sure it's the same person:
- In today's pull, the book lists the name in his game (the raw file names the teams), at a price near the other books' for him.
- In a snapshot, the name sits at a price near the other books' for him in that folder's files.
- It isn't another player. Brothers and namesakes share surnames. The check drops names a known player goes by, but it only knows players who've been listed.

A namesake isn't a fix. Leave it, and say so in the report.

## 4. Fix

### Names: `oddsNameMap` in `src/dataProcessor.ts`

- Add one entry per confirmed lead, as the report suggests. Copy the spelling exactly from the report or the book's file, including curly apostrophes and accents.
- Keep the list in alphabetical order of key, ignoring case, and end the line with the books that use the spelling: `// bet2 bet4`.
- The key is normally the roster name (`firstName.default` and `lastName.default` from the player file), which `compilePlayerList` starts from.
- Every book in comparison mode takes its names from the comparison pages, so one spelling there misses in all of them at once. One entry covers them all; list each of them in its comment.
- For a miss only the archive replays have, the report keys the entry so the archive lookup reaches the book's spelling:
  - The pick list and the roster disagree, and the books use the roster's spelling: map the roster name to the pick list's. The lookup reads it backwards, from the pick-list name to the roster's.
  - Otherwise: map the pick-list name to the book's spelling.
- One key holds one spelling. If the key already maps to a spelling still in use, or two books spell the player two ways, don't overwrite it. Say so in the report.
- Leave an entry whose spelling no book uses any more, because old snapshots still carry it.
- The two Elias Petterssons are told apart by player id in `src/dataProcessor.ts`, which writes out each book's spelling for them. A change to one of those spellings is fixed there, not in the map. A book's spelling follows its mode, since the comparison pages spell names their own way.
- Fix a name with a map entry, never new matching code, since the map is what both matchers read.

### Parsing: the fetchers and the comparison parser in `public/fetch_lib.php`

Only when the report shows a book's format changed and you've found the new shape in its raw files.
- Read the new shape alongside the old, and keep the existing branches unless the old shape is certainly gone. Books switch back and forth, sometimes within a day.
- Read only the anytime market, every priced player, with prices as decimal odds. Skip a selection without a price rather than divide by it.
- Give any new parameter a default. `update.php` calls the library too, and nothing checks the two against each other (the header comment in `fetch_lib.php`).
- `scripts/pull.php` calls `updateBooks` the way `update.php` does. If its signature changes, change the calls in `update.php`, `fetch_service.php` and `pull.php` together. The fetchers share one signature, since `updateBooks` calls them through a table.
- Comments state the rule, never the case: no book key, date or game.

### Then verify

- After a name fix, run `npx tsc -b`, `npx eslint src/dataProcessor.ts`, and the check again with `--no-pull --out <the same folder>`. The misses should be gone, and nothing new missing.
- After a parser fix, run the check again with a new `--out`. That lints the changed parser and runs it against the live feeds.

## 5. Report

Report only the outcome. Leave out per-book verdicts, the evidence behind a fix, and how a change reaches the site.

If every part of the check ran and nothing needed fixing, the whole report is one line: **Clean.** A finding that turns out fine once confirmed (step 3) isn't a problem.

Otherwise, two lists:
- **Problems**, most severe first, one line each: what's wrong, then either "fixed" (by a change listed below) or why it's left. Leads left alone, as namesakes or key conflicts, go here. So does any part of the check that couldn't run: a book whose fetch failed, names skipped, no live folder.
- **Code changes**: each change, by file. Give map entries as the lines added, and a parser change as the function and what it now reads. Write "None" if nothing changed.
