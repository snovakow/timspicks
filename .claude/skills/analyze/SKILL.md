---
name: analyze
description: Test the recorded history for real effects. Correlation - whether picks from one game score together beyond their odds, and whether the correlation table's factors hold up, settle, or improve the app's picks. Time slot - whether picks made with 1, 2, 3 or 4+ games left in the lists, or early versus late in the day, do better. Sportsbooks - whether one book's picks, or the average's, do better. Regular season vs playoffs - whether any of those results changes between the two. Rebuilds every archived pick window the way the app's archive replays do, proves the rebuild against the app's own correlation table, and tests actual results by day with multiple-comparison correction. Read-only. Use when asked whether correlation, a time slot or a sportsbook has a significant edge, whether to turn the correlation feature on, or whether the correlation factors are settling.
argument-hint: "[--since YYYY-MM-DD] [--until YYYY-MM-DD] [--format regular|playoff] [--root <site folder>]..."
model: opus
effort: max
allowed-tools: Read, Grep, Glob, Bash(node .claude/skills/analyze/scripts/analyze.mjs:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(ls:*)
---

# Archive analysis

Arguments: $ARGUMENTS

This skill answers four questions from the archive: the recorded pick lists, odds and results.
- **Correlation.** Do picks from one game, on one team or on opposing teams, score together more or less than their odds say? Do the correlation table's factors show it, settle as the archive grows, or improve the app's picks?
- **Time slot.** A slot is the number of games left in the lists when the picks are made, 1, 2, 3 or 4+: the app's Pool Slots, so it's also how late in the day they're made. Does any slot, or picking at the day's first or last window, give better results?
- **Sportsbooks.** Does one book's top ticket, or the Avg's, hit more often?
- **Regular season vs playoffs.** Does any of those answers change between the two? Playoff days have fewer games, lower odds and the same two teams night after night, so a result can hold in one and not the other, and pooling can hide it.

The strategies are the app's: Streak is at least one correct pick, Points scores the day by number correct, and Pick% is the share of picks correct. docs/hockey-challenge.md explains them and the ticket shapes.

It only reads. Never:
- edit `src/correlationData.ts`, or `analyze` in `src/features.ts`: the user regenerates the table
- change code to act on a finding. Report it, and leave the decision to the user
- write to `data/`, `history/`, `players/` or `auth.json` anywhere, or copy between the live folder and `public/`
- request `update.php`, `fetch_service.php` or `fetch.php` over HTTP

The repo is public. The report shows local paths and the books' names, so keep both out of anything tracked.

## 1. Run it

    node .claude/skills/analyze/scripts/analyze.mjs $ARGUMENTS

It takes about 20 seconds.
- `--since`, `--until`: only these days, inclusive. `--since` with a season's first day, from the history index, keeps that season alone.
- `--format regular` or `--format playoff`: that format alone. The default run already compares the two, in the report's section 4.
- `--root <site folder>`, repeatable: read only these folders, in this order, instead of the live folder and then `public/`. `--root public` sees exactly what a GENERATE run on the dev server sees.
- `--live <dir>`: the live folder, when discovery fails.
- `--out <dir>`: save the rebuilt windows (`windows.json`), every number (`results.json`) and this archive's table (`table.json`). Use a scratchpad folder.
- `--seed N`, `--boot N`: the resampling seed (1) and bootstrap draws (10,000).

History days come from every site folder's `history/`, so a day fetched into only one of them still counts. Each day's snapshots come from the live folder first, which the cron writes, then `public/`. The live folder is found the way health-server finds it. The app's own code does the matching and scoring, loaded from `src/` through Vite: the name matcher, the ticket shapes, the strategies' values and `runSimulation` itself.

## 2. Reading the report

### Header

- **Rebuild check.** It must say the rebuilt windows give `runSimulation`'s table exactly. The script runs the app's simulation over the same archive and compares every value. A failure means the rebuild no longer mirrors the app, usually after a change to the archive replays. Report it and draw no conclusions.
- **`src/correlationData.ts`** says whether the table in the working tree matches this archive. A table generated on the dev server reads `public/`, which lacks any day only the live folder holds. `--root public` checks whether it matches what the dev server saw.
- **Skipped windows** are the ones the app's replays skip too. A history day with no usable window has no snapshots, so its results are missing from everything below.

### How significance is decided

- The unit is the day. Windows on one day share players and results, so every interval resamples whole days, and every paired test flips whole days.
- Each family of tests is corrected together (Holm). A result is significant only when its Holm-adjusted p is under 0.05. A raw p under 0.05 among many tests is what chance produces now and then.
- **Primary** tests answer the four questions and decide the conclusion:
  - the two pair lifts, and the Avg's Streak and Points backtests
  - the same-day slot comparisons on Streak
  - the any-book tests, and only then each book against the Avg
  - the difference between the formats in each of those, and each of those within one format when its difference is significant
- Everything else is **secondary**. It's listed when significant, but it doesn't change the pick on its own: with this many families, one comes up by chance now and then.
- The verdicts end with **Significant results**, every result significant within its own family, and a **Conclusion**. The Conclusion keeps the top Avg player in each pick pool as the best option unless a primary result beats it. A significant slot comparison adds when to pick. A primary result within one format changes the pick for that format only. It also names anything that did significantly worse, any secondary result to recheck, and any result that differs between the formats.

### 1. Correlation

- **Teammates and opponents** (primary). Every pair of listed players on a day: teammates, opponents, and players from different games. "At their odds" multiplies the two Avg prices. Those carry the books' margin, so on raw counts every kind of pair scores together less often than its odds say. The margin also drifts from day to day, so each day's teammate or opponent pairs are compared with that day's different-game pairs, which can't be correlated. That's the lift, and 1 means no correlation. Pooling the days instead reads below 1 even with nothing there. A lift above 1 for teammates would make a stacked Streak ticket worse than its odds, and a stacked Points ticket better.
- **The table's factors** (a family of their own). Each factor the app applies, the ones above 1, is tested against its own shape's odds. On the windows it was counted in, did that shape's ticket score differently from what its picks' odds say, after the slot's margin? Exact tests, Holm across all of them. Most factors rest on a handful of windows. A shape that hit on all of its few windows gets a large factor that means nothing. Pick% factors can't measure correlation at all, because the expected number of correct picks doesn't depend on it.
- **Backtest** (Avg Streak and Points are primary). The app's highlighted pick for each book and strategy, with correlation off and on. "Held out" refits the table without the day being tested, and is the honest number. "In sample" lets each day vote for its own picks, which flatters the table. "Changed" counts the windows the flag would change.
- **Settling.** The table regenerated after every archive day, with today's code. Factors steady as the archive grows whether or not an effect is real, because each is an average. So a steadier table proves nothing by itself. The committed tables in git can't show it either, since their changes mix new data with changes to the method. The test is a set of chance runs: the same windows and picks, and each day's real results, shuffled among players of about the same price. That keeps how much was scored each day and at each price, and breaks any link between players of one game. Only more factors above 1, or settled above 1, than chance leaves there would suggest real boosts.

### 2. Time slot

- The ticket is the Avg's top ticket. With correlation off it's every strategy's pick.
- The per-slot table is descriptive. The slots come from different days: most 1-game windows are playoff days, when odds run lower. So compare slots on the same day.
- **Same-day comparisons** (primary, Streak). For each pair of slots, the days that had both. "Better on" counts the days each did better; with one window each per day, the test is McNemar's. The rows share days: a day's last window is usually its 1-game window, so "first vs last window" and "N vs 1 game" are the same evidence, not separate confirmations.
- An advantage has to show in results. The odds of each slot are visible when the picks are made.

### 3. Sportsbooks

- A book's top ticket is the best by its own prices among the players with an Avg, as the app highlights it. Only windows where all five have a ticket count.
- **Differs from Avg.** The windows where a book's ticket isn't the Avg's, usually by one list, with both tickets' Streak rate there. Only those windows can separate a book from the Avg.
- **Any book different** (primary). The five labels are shuffled within each day. Only when this is significant do the "vs Avg" rows say which book, after Holm.
- **Player level.** AUC over every player all four books priced: how often a scorer was priced above a non-scorer. It uses far more data than the top tickets do, but a gap of a hundredth needs thousands of player-days to show.
- **By pick pool.** How often each book's top player in Pick #1, #2 and #3 scored, with an any-book test per pool. It checks the Avg as the guide for each pool on its own. A book is compared with the Avg only in a pool whose test is significant.
- **By slot.** The rates Best Streak Picks weights each book with, slot by slot. When no slot's any-book test is significant, that weighting rests on noise.

### 4. Regular season vs playoffs

- Each primary result, and each book's AUC against the Avg's, measured within the regular season and within the playoffs by the same test as the pooled one, and the difference between them. The regular season pools every season's regular days. A run with one format only says so and skips this.
- Two families per question: both formats' own tests together, and the differences together. The verdicts give the closest of each.
- **The difference** is what says whether the format changes a result. Most paired days differ by a whole result or not at all, so it's tested by shuffling the format labels among the days, not by resampling. It needs 8 days in each format, and a row with fewer shows none: with fewer, the test finds differences that aren't there too often.
- **Within one format.** Without a significant difference, a result within one format is secondary: the pooled result stands, and the format only shows where the effect sits. A near-miss that points the same way in both formats is more likely real than one carried by a single format.
- Not split: the table's factors and settling. The app keeps one table for both formats, and a format difference in correlation would show in the lifts and backtests. The other backtests and the secondary slot and book tests aren't split either.
- The formats' days differ in more than format. Playoff days are mostly 1- and 2-game windows, and each format comes from its own part of the calendar. A difference says the result changed between the two sets of days, not why.

## 3. When a verdict is close

- Rerun with `--since` at the season's start to see whether a near-miss holds in this season alone. The format comparison already shows whether it holds in the regular season and the playoffs. A real effect points the same way in both.
- Rerun with `--seed 2` to see whether resampling noise moves a p that sits near 0.05. Exact tests don't move.
- With `--out`, `windows.json` holds every window's lists, prices, results and tickets, for looking at particular days.

Stop there. Slicing the archive until something comes out significant is just running more tests.

## 4. Report

Keep it short, and lead with the bottom line, from the script's Significant results and Conclusion:
- **Something is significant:** list each result. Give what it is, the effect with its 95% interval, the Holm-adjusted p, whether it's primary or secondary, and its format when it holds in one only. Then say what it means for the picks, as the Conclusion does.
- **Nothing is significant:** say so in one line, and that selecting the top Avg player in each pick pool remains the best option, because nothing tested beats it.

Then four lines, one per question: the verdict, the one or two numbers behind it (the effect with its 95% interval, and the Holm-adjusted p), and what it means for the app in a few words. For example: nothing in correlation is significant, so there's no case for turning it on. The correlation line also says whether the factors settle above 1 more often than chance. The format line says whether any result differs between the regular season and the playoffs, and names the closest difference with its Holm p.

Then add, only when they apply:
- A failed rebuild check, or a gap in the archive: history days without snapshots, or a table in `src/correlationData.ts` that doesn't match this archive. Say which days it lacks. Regenerating it is the user's step.
- The closest result to significance, when its Holm p is under 0.2, and what keeps it from significance: few days, or days shared with another comparison. Say whether it points the same way in the regular season and the playoffs, from the report's section 4.

Leave out the method, the tables and the per-book numbers unless asked.
