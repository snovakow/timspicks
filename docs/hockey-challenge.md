# The Hockey Challenge

How the contest works, and how this app reasons about it. The app is advisory
only: it ranks candidates from odds, and the picks are entered by hand in the
contest's own app. It has no notion of a pick being entered or locked — the
highlights it draws are its own recommendation, recomputed from scratch and
never saved.

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

Pool 1 holds the strongest scorers, pool 2 the middle, pool 3 the weakest, and
the tiers separate cleanly on both scoring odds and goals per game.

That ordering is a property of the pick-list feed, inherited silently. Nothing in
the app encodes or enforces it: the three lists are never compared with each
other, and the scoring functions are symmetric in the three probabilities. So
treat the ordering as a reliable observation, not an invariant.

## Lists are redrawn as games start

After each game's start time the three lists can be redrawn, with players added
and players removed. Only players whose own game has not started are eligible,
so the pool shrinks through the evening, and the last redraw covers only the
final time slot's games.

How to read the lists, based on a season of archived draws:

- **The final pool is every game in the day's last time slot.** A game missing
  from the current lists will not necessarily be missing from the final draw.
- **A list holds at most 15 players.** The cap is real, but it lives only in the
  data — nothing in the app asserts or enforces it.
- **An under-cap list is complete for its tier.** A list of fewer than 15 has
  held every eligible player of that tier from every game still in the pool. So
  an under-cap list holding none of a game's players is real evidence that the
  game was not in that draw — strong evidence, not proof. A full list proves
  nothing either way.
- **Top stars are never listed.** The most expensive scorers have never turned
  up in a pool. Leave them out when judging what a redraw could add.
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
and two correct, and a week of free coffee for the streak.

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

Three picks can share a game, which can make their outcomes dependent. Every
ticket is classified by shape: how many of its picks fall in the same game, and
whether same-game picks are on one team or on opposing teams. The shapes run from
all three in different games, through the mixed stacked and opposing cases, to
all three on one team, and each gets an English name in the interface.

The correlation itself comes down to two numbers measured on the archived
history: how many times as often two teammates both scored as their odds say,
and the same for two opponents. Each is measured against the same day's pairs
from different games, which can't be correlated and so cancel the books' margin.
Picks from different games are taken as independent.

A ticket is valued from its own players' odds with those two numbers. Each
same-game pair's chance of both scoring is scaled by its number, and the chance
that all three score by the product of its three pairs'. Every joint chance is
kept within what the players' own chances allow, so a value never leaves its
natural range: a probability stays a probability, and points stay within a
perfect day's score. The correlation slider scales the effect, from none up to
the measured numbers and beyond.

Correlation cuts both ways. Players who tend to score together make at least one
correct pick less likely, because their goals overlap, and two or three correct
more likely. So a pair that scores together more than its odds say lowers a
ticket's Streak value and raises its Points value, and the effect grows with the
players' chances, so it matters most for the strongest picks. It cannot move
Pick% at all: the expected number of correct picks is the same whether or not
picks score together.

An earlier version kept a separate factor per shape, slate size, book and
strategy. Those are all one mechanism — whether players from one game score
together — so that table estimated the same two numbers many times over, most of
its factors from a handful of archived draws. And since only factors above the
baseline were applied, their noise could only ever boost a ticket. Measured on
2026-10-17 over the archive through 2026-10-15, teammates scored together about
1% more often than their odds say and opponents about as often, neither
distinguishable from no correlation.

## A naming trap

"Pick #1 / #2 / #3" are the three pools. "Pool Slots" are the **number of games
on the slate**, by which the historical audit buckets its results. Two unrelated
axes that both count 1, 2, 3.
