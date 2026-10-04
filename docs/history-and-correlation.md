# History and the correlation table

<!-- runbook -->

The correlation factors the app ships are not written by hand. They are derived
from the day-by-day archive the server keeps, by a simulation that runs inside
the app. This is the order things have to happen in, and the traps that make a
regeneration look like it worked when it did nothing.

## Two different kinds of generated data

|  | the history archive | the generated factors |
| --- | --- | --- |
| Holds | one JSON file per game day: pick lists, odds, who scored | correlation factors derived from that archive |
| Written by | the **History** action on the admin page | pasted in by hand from a console dump |
| Owned by | the server | the repo |
| In git | no — the archive is gitignored | yes, it is committed source |

So a regeneration has two halves that are easy to confuse: extending the
**archive** (new game days), and re-deriving the **factors** from whatever the
archive already holds. Only the second one changes a committed file.

## Step 1 — extend the archive, if you want newer days

Skip this entirely when re-deriving from the days already on disk.

The season range table lives in the scraping service, and the **History** action
on the admin page is the only thing that ever writes the archive. [The app and
the server](app-and-server.md) covers the index mechanics and the two rules that
matter most — set a range's end to the last completed day and never to today, and
never edit a range that is not the last one. Both are append-only traps that
silently poison the index rather than erroring.

A local archive and the live one drift independently. The range table can list a
range the local index has never fetched, so check what the index actually holds
rather than what the table says is available:

```sh
python3 -c "
import json,io
for e in json.load(io.open('public/history/history.json')):
    print(e['season'], e['format'], e['start'], '->', e['end'], len(e.get('files', [])), 'files')
"
```

## Step 2 — re-derive the factors

1. Set `analyze` to `'GENERATE'` in `src/features.ts`. That arms a single
   simulation run, fired once after the page's data has initialized.
2. `npm run dev`, open the page, and wait for the odds tables to appear. The
   simulation does not start until the live data has loaded, because it runs off
   the same initialization path.
3. The console logs one object: the whole result, keyed slate size → book →
   strategy → shape.
4. Copy that object as text — in the browser devtools, right-click it and choose
   **Copy object**. Expanding and selecting it by hand gives you the devtools'
   display form, not valid JSON.
5. Paste into `src/correlationData.ts`, replacing the whole exported object
   literal. Keep the import line and the exported types above it — the pasted
   JSON is only the object.
6. **Set `analyze` back to `'OFF'`.** This is a release gate: the `/commit` scan
   refuses to proceed while it is anything else. Leaving it on is the single
   easiest mistake to make here, because nothing in the app misbehaves.
7. `npx tsc --noEmit`, `npx eslint src/`, `npm run build`.

## What bounds the simulation, regardless of the archive

Three choices decide what a run actually sees. None of them are obvious from the
output:

- **A hardcoded earliest date.** Archived days before it are skipped no matter
  how far back the archive goes, and there is a second, independent copy of the
  same cutoff in the historical audit path. Extending the archive backwards can
  therefore change nothing at all.
- **A near-tie band**, which decides when a candidate ticket counts toward a
  shape's observations: it counts when it scores within a hair of the best ticket.
  Widening the band widens the sample per shape and changes every factor.
  Three things about it are worth knowing before trusting a factor. It admits
  genuinely worse tickets rather than merely absorbing floating-point noise,
  since it is orders of magnitude wider than rounding error. It is an *or* across
  all three strategies, so clearing the band on any one of them is enough, which
  widens it further than the single number suggests. And it was set once and never
  swept against the alternatives, so nothing establishes that value as the right
  one — yet every factor in the committed table depends on it.
- **Slate bucketing.** Factors are bucketed by the number of games on the slate.
  One aggregate bucket covering every slate is still generated, and nothing reads
  it.

## If the regenerated table comes out identical

That is the expected result, not a failure, whenever **both** inputs are
unchanged: the same archived days and the same derivation code. The pipeline is
deterministic, so an identical paste leaves `git status` clean and is a decent
confirmation that the process ran correctly end to end.

So before concluding a run did nothing, check which of the two you actually
changed:

- Added game days to the archive? The factors should move.
- Changed how a factor is derived? The factors should move.
- Changed the points table? The points factors should move, and others can too,
  since the points scoring decides which groups count at all.
- Neither — only armed the run and ran it? Byte-identical output is correct.

The derivation divides each shape's mean outcome by the baseline shape's mean.
Editing how factors are *applied* does **not** change the table — application and
derivation are separate steps, and only the second one is baked into the
committed factors.

## Two things that are easy to get wrong about the counts

A shape's count is **not** a number of candidate pick-combinations. Each
simulation item contributes at most 1, because its count is collapsed to 1 before
the item is folded in. So the count is "how many separate day × slot × book items
did this shape appear in", and each bucket is capped by however many items landed
in it. Any threshold on this number can be unreachable for a bucket rather than
merely strict — a floor of 20 empties every multi-game bucket completely on a
51-day archive.

The aggregate bucket is far better sampled than any per-slate bucket, because it
aggregates every slate. Nothing reads it, but it is the obvious place to look if
sparse per-slate shapes ever need a fallback.

## Checklist

- [ ] Decided whether this run needs new archive days at all
- [ ] If extending: the range end is a completed day, and only the last range was
      touched
- [ ] Confirmed what the local index holds, not just what the range table lists
- [ ] `analyze` set to `'GENERATE'`, page loaded, data visible before the dump
      appeared
- [ ] Remembered a table-wide diff is expected only if an input really changed
- [ ] Pasted as JSON via **Copy object**, import and type exports preserved
- [ ] `analyze` back to `'OFF'`
- [ ] Type-check, lint and build clean
- [ ] If the diff is empty, confirmed that an input really did change
