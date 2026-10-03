# The Hockey Challenge

How the contest works, and how this app reasons about it. The app is advisory
only: it ranks candidates from odds, and the picks are entered by hand in the
contest's own app.

## Three picks a game day

A game day covers every game scheduled for that day, and it takes three
picks. Each pick comes from its own pre-selected pool of players — one pool per
pick — and the pools are independent, so any pick 1 × pick 2 × pick 3
combination is a legal ticket. The app enumerates exactly that product, in
`calculateStats` (`src/statsCalculations.ts`) for the stats view and in
`bestPicks` (`src/picksOptimizer.ts`) for the recommendation.

The pools arrive from the pick-list feed as `helper.json`, keyed `"1"`, `"2"`
and `"3"`, bucketed by the feed's own list id in `updatePicks`
(`public/fetch_lib.php`). The front end holds them as `PlayerDataByPick`
(`src/dataProcessor.ts`) and renders one independently sortable table per pool,
under the headings Pick #1, Pick #2 and Pick #3 (`src/App.tsx`).

## The pools are tiered, but only in the data

Pool 1 holds the strongest scorers, pool 2 the middle, pool 3 the weakest.

That ordering is a property of the pick-list feed, inherited silently. Nothing
in `src/` encodes or enforces it: there is no `tier` identifier, the three lists
are never compared with each other, and the scoring functions are symmetric in
`prob1`/`prob2`/`prob3` (`calcAny`, `calcPnt`, `calcHit` in
`src/picksOptimizer.ts`). The tiers separate cleanly all the same — measured
across one archived slot:

| Pool | Mean implied probability | Mean goals per game |
| ---- | -----------------------: | ------------------: |
| 1    | 26.9%                    | 0.276               |
| 2    | 16.3%                    | 0.148               |
| 3    | 9.4%                     | 0.082               |

Treat the ordering as a reliable observation, not an invariant.

## Lists are redrawn as games start

After each game's start time the three lists can be redrawn, with players added
and players removed. Only players whose own game has not started are eligible,
so the pool shrinks through the evening, and the last redraw covers only the
final time slot's games.

How to read the lists, based on a season of archived draws:

- **The final pool is every game in the day's last time slot.** A game missing
  from the current lists will not necessarily be missing from the final draw.
- **A list holds at most 15 players.** Confirmed at exactly 15 across all 132
  archived snapshots on hand. The cap is real, but it lives only in the data —
  no constant, assertion or truncation exists in `src/`.
- **An under-cap list is complete for its tier.** Across the 2025-26 history, a
  list of fewer than 15 held every eligible player of that tier from every game
  still in the pool, in 1,615 of 1,615 checks. So an under-cap list holding none
  of a game's players is real evidence that the game was not in that draw —
  strong evidence, not proof. A full list proves nothing either way.
- **Top stars are never listed.** The most expensive scorers had zero
  appearances across the whole 2025-26 history. Leave them out when judging what
  a redraw could add.
- **A last-slot game can still be skipped.** On 2026-10-01 a late game was left
  out of every draw that day — the first such case on record, and the under-cap
  evidence above predicted it.

### How the app models redraws

Two different mechanisms, depending on the view.

**Live.** `data/process.json` records when the data was last scraped, and
`loadGamesAndPlayers` (`src/dataProcessor.ts`) drops any game that started
before that timestamp, then drops the players whose team no longer maps to a
surviving game. That filter is the eligibility rule.

**Historical.** `getGameStartTimeGroups` (`src/picksOptimizer.ts`) reads an
archived day's schedule feed, converts each start time to Eastern, dedupes them
into `HHmm` strings and treats each one as a redraw boundary, loading that
slot's archived lists and odds.

One loose end worth knowing: `HistoryPlayer.availableTimes`
(`src/picksOptimizer.ts`) is the field that states per-player redraw
eligibility directly, and it is declared but never read — the app reconstructs
slots from game start times instead. To rebuild a slot's list from the history
archive, take the players whose `availableTimes` contains the last list time
before that slot.

## Scoring

Per game day, by number of correct picks (`calcPnt` and `Outcome` in
`src/picksOptimizer.ts`):

| Correct | Points |
| ------: | -----: |
| 0       | 0      |
| 1       | 25     |
| 2       | 50     |
| 3       | 100    |

At least one correct pick on seven straight days earns a week of free coffee.
Nothing in the app tracks a streak; the `least1` strategy is a single-day proxy
for it.

## The three strategies

`AllStrategies` (`src/dataTypes.ts`) names what a ticket can be optimized for:

| Key      | Label  | Maximizes                                          |
| -------- | ------ | -------------------------------------------------- |
| `least1` | Streak | P(at least one correct) — `calcAny`                |
| `points` | Points | expected points on the table above — `calcPnt`     |
| `hits`   | Pick%  | expected number of correct picks — `calcHit`       |

`top` is a fourth display mode: the highest-probability ticket with no strategy
constraint. Which one to play depends on the goal — protecting a streak, a
points total, or leaderboard pick percentage.

## Correlation between picks

Three picks can share a game, which makes their outcomes dependent. Every
ticket is classified by shape in `getStrategy` (`src/strategySelection.ts`)
into one of the 11 patterns in `AllCombos` (`src/dataTypes.ts`): `iii` for all
three in different games, `sss` for all three on one team, and the mixed
stacked and opposing cases between. `strategyTitle` gives each an English name
("All Independent", "2-3 Stacked, 1 Independent", and so on).

`src/correlationData.ts` is a generated lookup of correlation factors for those
shapes, indexed by pool slots × book × strategy × pattern, produced by
`runSimulation` (`src/picksOptimizer.ts`) over the archived history. Two things
to know about it: a factor below 1 is ignored, so correlation can only boost a
ticket and never penalize one, and `null` means no observations — `iii`, for
instance, is structurally impossible on a one-game slate.

`applyCorrelation` (`src/picksOptimizer.ts`) applies the factor to the *odds*
rather than multiplying it into the value. Note the asymmetry: a factor is
*derived* as a ratio of rates but *applied* as a ratio of odds, which is an
approximation — deliberate, because it is what keeps a boosted value bounded. Each strategy has a natural maximum
(`StrategyMax`: 1 for `least1`, 100 for `points`, 3 for `hits`), and scaling in
odds space keeps a boosted result below that maximum — a raw multiply would push
`least1` past 100%. The transform is strictly monotone, so it never saturates and
ranking between tickets stays meaningful.

## A naming trap

"Pick #1 / #2 / #3" are the three pools. "Pool Slots 1 / 2 / 3 / 4+"
(`AllPoolSlots` in `src/dataTypes.ts`, `resolvePoolKey` in
`src/picksOptimizer.ts`) is the **number of games on the slate**, used to bucket
the correlation data. Two unrelated axes that both count 1, 2, 3.

## What the app doesn't model

- **Challenge periods and the leaderboard.** A season is only `regular` or
  `playoff` in the history archive. The Challenge windows and rankings are
  described in `README.md`, not in code.
- **Submitted picks.** There is no notion of a pick being entered or locked;
  derived pick state is cleared on every recompute (`clearDerivedPickState`,
  `src/App.tsx`).
- **The contest's tie-break rules.** The app's own tie-breaks are its
  preferences for presenting equally probable tickets, nothing more.
