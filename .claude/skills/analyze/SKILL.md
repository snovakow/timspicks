---
name: analyze
description: Test the recorded history for real effects. Correlation - whether picks from one game score together beyond their odds, whether that holds for the players near the top of the lists, and whether the app's correlation lifts improve its picks. Time slot - whether picks made with 1, 2, 3 or 4+ games left in the lists, or early versus late in the day, do better. Sportsbooks - whether one book's picks, or the average of any two, three or all four books, do better. Regular season vs playoffs - whether any of those results changes between the two. Rebuilds every archived pick window the way the app's archive replays do, proves the rebuild against the app's own correlation lifts, and tests actual results by day with multiple-comparison correction. Read-only. Use when asked whether correlation, a time slot or a sportsbook has a significant edge, whether to turn the correlation feature on, or whether the correlation lifts hold for the top picks.
argument-hint: "[--since YYYY-MM-DD] [--until YYYY-MM-DD] [--format regular|playoff] [--root <site folder>]..."
model: opus
effort: max
allowed-tools: Read, Grep, Glob, Bash(node .claude/skills/analyze/scripts/analyze.mjs:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(ls:*)
---

# Archive analysis

Arguments: $ARGUMENTS

This skill answers four questions from the archive: the recorded pick lists, odds and results.
- **Correlation.** Do picks from one game, on one team or on opposing teams, score together more or less than their odds say? Does that hold for the players near the top of the lists, whom the picks come from? Do the app's correlation lifts improve its picks?
- **Time slot.** A slot is the number of games left in the lists when the picks are made, 1, 2, 3 or 4+: the app's Pool Slots, so it's also how late in the day they're made. Does any slot, or picking at the day's first or last window, give better results?
- **Sportsbooks.** Does the top ticket of one book, or of the average of any two, three or all four books, hit more often? Those are the 15 subsets of the four books, and the average of all four is the Avg.
- **Regular season vs playoffs.** Does any of those answers change between the two? Playoff days have fewer games, lower odds and the same two teams night after night, so a result can hold in one and not the other, and pooling can hide it.

The strategies are the app's: Streak is at least one correct pick, Points scores the day by number correct, and Pick% is the share of picks correct. docs/hockey-challenge.md explains them and the ticket shapes.

It only reads. Never:
- edit `src/correlationData.ts`, or `analyze` in `src/features.ts`: the user regenerates the lifts
- change code to act on a finding. Report it, and leave the decision to the user
- write to `data/`, `history/`, `players/` or `auth.json` anywhere, or copy between the live folder and `public/`
- request `update.php`, `fetch_service.php` or `fetch.php` over HTTP

The repo is public. The report shows local paths and the books' names, so keep both out of anything tracked.

## 1. Run it

    node .claude/skills/analyze/scripts/analyze.mjs $ARGUMENTS

It takes about 25 seconds.
- `--since`, `--until`: only these days, inclusive. `--since` with a season's first day, from the history index, keeps that season alone.
- `--format regular` or `--format playoff`: that format alone. The default run already compares the two, in the report's section 4.
- `--root <site folder>`, repeatable: read only these folders, in this order, instead of the live folder and then `public/`. `--root public` sees exactly what a GENERATE run on the dev server sees.
- `--live <dir>`: the live folder, when discovery fails.
- `--out <dir>`: save the rebuilt windows (`windows.json`), every number (`results.json`) and this archive's lifts (`lifts.json`). Use a scratchpad folder.
- `--seed N`, `--boot N`: the resampling seed (1) and bootstrap draws (10,000).

History days come from every site folder's `history/`, so a day fetched into only one of them still counts. Each day's snapshots come from the live folder first, which the cron writes, then `public/`. The live folder is found the way health-server finds it. The app's own code does the matching and scoring, loaded from `src/` through Vite: the name matcher, the strategies' values, the valuing of tickets with the lifts, and `runSimulation` itself.

## 2. Reading the report

### Header

- **Rebuild check.** It must say the rebuilt windows give `runSimulation`'s lifts exactly. The script runs the app's lift fitting over the same archive and compares all six values: the two lifts and what they were fitted on. A failure means the rebuild no longer mirrors the app, usually after a change to the archive replays. Report it and draw no conclusions.
- **`src/correlationData.ts`** says whether the lifts in the working tree were fitted on this archive, and names each value that differs. Lifts generated on the dev server read `public/`, which lacks any day only the live folder holds. `--root public` checks whether they match what the dev server saw.
- **Skipped windows** are the ones the app's replays skip too. A history day with no usable window has no snapshots, so its results are missing from everything below.

### How significance is decided

- The unit is the day. Windows on one day share players and results, so every interval resamples whole days, and every paired test flips whole days.
- Each family of tests is corrected together (Holm). A result is significant only when its Holm-adjusted p is under 0.05. A raw p under 0.05 among many tests is what chance produces now and then.
- **Primary** tests answer the four questions and decide the conclusion:
  - the two pair lifts, and the Avg's Streak and Points backtests
  - the same-day slot comparisons on Streak
  - the any-subset tests, and only then each subset against the Avg
  - the difference between the formats in each of those, and each of those within one format when its difference is significant
- Everything else is **secondary**. It's listed when significant, but it doesn't change the pick on its own: with this many families, one comes up by chance now and then.
- The verdicts end with **Significant results**, every result significant within its own family, and a **Conclusion**. The Conclusion keeps the top Avg player in each pick pool as the best option unless a primary result beats it. A significant slot comparison adds when to pick. A primary result within one format changes the pick for that format only. It also names anything that did significantly worse, any secondary result to recheck, and any result that differs between the formats.

### 1. Correlation

- **Teammates and opponents** (primary). Every pair of listed players on a day: teammates, opponents, and players from different games. "At their odds" multiplies the two Avg prices. Those carry the books' margin, so on raw counts every kind of pair scores together less often than its odds say. The margin also drifts from day to day, so each day's teammate or opponent pairs are compared with that day's different-game pairs, which can't be correlated. That's the lift, and 1 means no correlation. Pooling the days instead reads below 1 even with nothing there. A lift above 1 for teammates would make a stacked Streak ticket worse than its odds, and a stacked Points ticket better. These two lifts are what the app fits and ships: with correlation on, it values every ticket from its players' prices with them.
- **Near the top of the lists** (secondary, a family of its own). The same lifts among pairs where both players were within 25% of their list's top Avg price, against all other pairs. The app fits on every pair, and most pairs include a player the picks never come from. A significant difference would mean fitting on the near-top pairs instead, and the Conclusion says so. The cutoff was chosen, not calibrated. The near-top pairs are under a third of the total but carry more than their share of the weight, so their interval is only a little wider.
- **Backtest** (Avg Streak and Points are primary). The app's highlighted pick for each book and strategy, with correlation off and on. With it on, every ticket is valued with the lifts, as the app's Stats view picks. "Held out" refits the lifts without the day being tested, and is the honest number. "In sample" lets each day vote for its own picks. "Changed" counts the windows the lifts would change; with lifts near 1, only near-ties do. Tied tickets are averaged, as the top ticket is everywhere in the report. Pick% isn't backtested: correlation can't change the expected number of correct picks.

### 2. Time slot

- The ticket is the Avg's top ticket. With correlation off it's every strategy's pick.
- The per-slot table is descriptive. The slots come from different days: most 1-game windows are playoff days, when odds run lower. So compare slots on the same day.
- **Same-day comparisons** (primary, Streak). For each pair of slots, the days that had both. "Better on" counts the days each did better; with one window each per day, the test is McNemar's. The rows share days: a day's last window is usually its 1-game window, so "first vs last window" and "N vs 1 game" are the same evidence, not separate confirmations.
- An advantage has to show in results. The odds of each slot are visible when the picks are made.

### 3. Sportsbooks

- **Subsets.** Every test here runs over the 15 subsets of the four books: each book alone, the six pairs, the four triples, and all four, which is the Avg. A subset prices a player at the average of its books that price him, as the Avg does. The app shows only the books and the Avg; the pairs and triples exist only in this analysis.
- A subset's top ticket is the best by its own prices among the players with an Avg, as the app highlights a book's. With 3+ books needed for an Avg, the app's default, every pair and triple prices every player the Avg does, so their lists are the Avg's and only the prices differ. Only windows where all 15 have a ticket count.
- **Differs from Avg.** The windows where a subset's ticket isn't the Avg's, usually by one list, with both tickets' Streak rate there. Only those windows can separate a subset from the Avg.
- **Any subset different** (primary). Whether the 15 rates are further apart than chance would put them. Each day's deviations from its own mean over the 15 keep or flip their sign together, as the paired tests flip a day's difference. Shuffling the labels within days would treat the subsets as interchangeable, and they aren't: a triple picks the Avg's ticket in most windows. On the archive's own windows with no real differences, such a shuffle found one about twice as often as it should. Only when this test is significant do the "vs Avg" rows say which subset, after Holm over the 14.
- **Player level.** AUC over every player all four books priced: how often a scorer was priced above a non-scorer. It uses far more data than the top tickets do, but a gap of a hundredth needs thousands of player-days to show.
- **By pick pool.** How often each subset's top player in Pick #1, #2 and #3 scored, with an any-subset test per pool. It checks the Avg as the guide for each pool on its own. A subset is compared with the Avg only in a pool whose test is significant.
- **By slot.** Each subset's Streak rate slot by slot; the books' and the Avg's are the rates Best Streak Picks weights them with. When no slot's any-subset test is significant, that weighting rests on noise.

### 4. Regular season vs playoffs

- Each primary result, and each subset's AUC against the Avg's, measured within the regular season and within the playoffs by the same test as the pooled one, and the difference between them. The regular season pools every season's regular days. A run with one format only says so and skips this.
- Two families per question: both formats' own tests together, and the differences together. The verdicts give the closest of each.
- **The difference** is what says whether the format changes a result. Most paired days differ by a whole result or not at all, so it isn't tested by resampling. Each day's difference keeps or flips its sign at random, as in the paired tests, and stays in its own format. Each gap is scaled by its spread about zero, so the test is exact when neither format has an effect, and errs safe when both have the same one. Shuffling the days between the formats would count it as a difference when one format's days differ at all more often than the other's, and find more of those the more days the other format adds. It needs 8 days in each format, and a row with fewer shows none: with fewer, the sign flips rarely find even a large difference, and the lifts' and AUCs' bootstraps run too narrow.
- **Within one format.** Without a significant difference, a result within one format is secondary: the pooled result stands, and the format only shows where the effect sits. A near-miss that points the same way in both formats is more likely real than one carried by a single format.
- Not split: the near-top lifts. The app fits one pair of lifts for both formats, and a format difference in correlation shows in the lifts and backtests. The other backtests and the secondary slot and book tests aren't split either.
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

Then four lines, one per question: the verdict, the one or two numbers behind it (the effect with its 95% interval, and the Holm-adjusted p), and what it means for the app in a few words. For example: nothing in correlation is significant, so there's no case for turning it on. The correlation line also gives the near-top teammate lift against the other pairs' and its Holm p. The format line says whether any result differs between the regular season and the playoffs, and names the closest difference with its Holm p.

Then add, only when they apply:
- A failed rebuild check, or a gap in the archive: history days without snapshots, or lifts in `src/correlationData.ts` that weren't fitted on this archive. Say which values differ. Regenerating them is the user's step.
- The closest result to significance, when its Holm p is under 0.2, and what keeps it from significance: few days, or days shared with another comparison. Say whether it points the same way in the regular season and the playoffs, from the report's section 4.

Leave out the method, the tables and the per-subset numbers unless asked.
