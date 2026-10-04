# The Hockey Challenge

How the contest works, and how this app reasons about it. The app is advisory
only: it ranks candidates from odds, and the picks are entered by hand in the
contest's own app.

## Three picks a game day

A game day covers every game scheduled for that day, and it takes three picks.
Each pick comes from its own pre-selected pool of players — one pool per pick —
and the pools are independent, so any pick 1 × pick 2 × pick 3 combination is a
legal ticket. The app enumerates exactly that product, both for the stats view
and for its recommendation.

The pools arrive from the pick-list feed, which keys them by its own list ids.
The front end holds one pool per pick and renders an independently sortable
table for each, under the headings Pick #1, Pick #2 and Pick #3.

## The pools are tiered, but only in the data

Pool 1 holds the strongest scorers, pool 2 the middle, pool 3 the weakest.

That ordering is a property of the pick-list feed, inherited silently. Nothing in
the app encodes or enforces it: the three lists are never compared with each
other, and the scoring functions are symmetric in the three probabilities. The
tiers separate cleanly all the same — measured across one archived slot:

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
  nothing in the app asserts or enforces it.
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

**Live.** The run-state file records when the data was last scraped. The app
drops any game that started before that moment, then drops the players whose
team no longer maps to a surviving game. That filter is the eligibility rule.

**Historical.** For an archived day the app reads that day's schedule, reduces
the distinct start times to a set of slot boundaries, and treats each one as a
redraw, loading that slot's archived lists and odds.

One loose end worth knowing: the history feed states per-player redraw
eligibility directly, and the app ignores it, reconstructing slots from game
start times instead. To rebuild a slot's list from the archive by hand, take the
players whose available times include the last list time before that slot.

## Scoring

Per game day, by number of correct picks:

| Correct | Points |
| ------: | -----: |
| 0       | 0      |
| 1       | 10     |
| 2       | 25     |
| 3       | 100    |

At least one correct pick on seven straight days earns a free donut a day for a
week. Nothing in the app tracks a streak; the Streak strategy is a single-day
proxy for it.

These are the 2026-27 values. The 2025-26 season paid 25 and 50 points for one
and two correct, and a week of free coffee for the streak. The correlation
factors are derived using the points table, so changing it means regenerating
them ([History and the correlation table](history-and-correlation.md)).

## The three strategies

What a ticket can be optimized for:

| Label  | Maximizes                                  |
| ------ | ------------------------------------------ |
| Streak | the chance of at least one correct pick    |
| Points | expected points on the table above         |
| Pick%  | the expected number of correct picks       |

There is also a plain highest-probability display mode with no strategy
constraint. Which one to play depends on the goal — protecting a streak, a
points total, or leaderboard pick percentage.

## Correlation between picks

Three picks can share a game, which makes their outcomes dependent. Every ticket
is classified by shape: how many of its picks fall in the same game, and whether
same-game picks are on one team or on opposing teams. The shapes run from all
three in different games, through the mixed stacked and opposing cases, to all
three on one team, and each gets an English name in the interface.

A generated lookup holds a correlation factor per shape, split by how many games
are on the slate, by book and by strategy, derived from the archived history.
Two things to know about it: a factor below the independent baseline is ignored,
so correlation can only boost a ticket and never penalize one, and a shape can
have no observations at all — all three picks in different games is structurally
impossible on a one-game slate.

The factor is applied to the *odds* rather than multiplied into the value. Note
the asymmetry: a factor is *derived* as a ratio of rates but *applied* as a ratio
of odds, which is an approximation — deliberate, because it is what keeps a
boosted value bounded. Each strategy has a natural ceiling: a probability cannot
pass certainty, the points strategy cannot pass a perfect day's score, and the
hit count cannot pass three picks. Scaling in odds space keeps a boosted result
below that ceiling, where a raw multiply would push the streak probability past
100%. The transform is strictly monotone, so it never saturates and the ranking
between tickets stays meaningful.

The factors rest on one uncalibrated choice worth knowing about. A ticket counts
toward a shape's observations when it scores within a hair of the best ticket for
*any* of the three strategies. That near-tie band is wide enough to admit
genuinely worse tickets, not just absorb floating-point noise, and it was never
swept against the alternatives — yet every factor in the table depends on it.
Widening the band widens every shape's sample.

## A naming trap

"Pick #1 / #2 / #3" are the three pools. "Pool Slots" are the **number of games
on the slate**, used to bucket the correlation data. Two unrelated axes that both
count 1, 2, 3.

## What the app doesn't model

- **Challenge periods and the leaderboard.** A season is only regular or playoff
  in the history archive. The Challenge windows and rankings are described in the
  README, not in the app.
- **Submitted picks.** There is no notion of a pick being entered or locked;
  derived pick state is cleared on every recompute.
- **The contest's tie-break rules.** The app's own tie-breaks are its preferences
  for presenting equally probable tickets, nothing more.
