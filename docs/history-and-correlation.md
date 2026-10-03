# History and the correlation table

The correlation factors in `src/correlationData.ts` are not written by hand. They
are derived from the day-by-day archive in `public/history/` by a simulation that
runs inside the app. This is the order things have to happen in, and the traps
that make a regeneration look like it worked when it did nothing.

## Two different kinds of generated data

|  | `public/history/` | `src/correlationData.ts` |
| --- | --- | --- |
| Holds | one JSON file per game day: pick lists, odds, who scored | correlation factors derived from that archive |
| Written by | the **History** action on the admin page | pasted in by hand from a console dump |
| Owned by | the server | the repo |
| In git | no — `history` is gitignored | yes, it is committed source |

So a regeneration has two halves that are easy to confuse: extending the
**archive** (new game days), and re-deriving the **table** from whatever the
archive already holds. Only the second one changes a committed file.

## Step 1 — extend the archive, if you want newer days

Skip this entirely when re-deriving from the days already on disk.

The season range table is `$datesTotal` in `public/fetch_service.php`, and the
**History** action on `fetch.php` is the only thing that ever writes `history/`.
`docs/app-and-server.md` covers the index mechanics and the two rules that matter
most — set a range's `end` to the last completed day and never to today, and
never edit a range that is not the last one. Both are append-only traps that
silently poison the index rather than erroring.

A local archive and the live one drift independently. `$datesTotal` can list a
range that the local `public/history/history.json` has never fetched, so check
what the index actually holds rather than what the table says is available:

```sh
python3 -c "
import json,io
for e in json.load(io.open('public/history/history.json')):
    print(e['season'], e['format'], e['start'], '->', e['end'], len(e.get('files', [])), 'files')
"
```

## Step 2 — re-derive the table

1. Set `analyze` to `'GENERATE'` in `src/features.ts`. That is what flips
   `SIMULATE` in `src/App.tsx`, which calls `runSimulation` once after the page's
   data initializes.
2. `npm run dev`, open the page, and wait for the odds tables to appear. The
   simulation does not start until the live data has loaded, because it runs off
   the same initialization path.
3. The console logs one object: the whole `CorrelationResult`, keyed
   pool slots → book → strategy → combo pattern.
4. Copy that object as text — in Chrome devtools, right-click it and choose
   **Copy object**. Expanding and selecting it by hand gives you devtools' display
   form, not valid JSON.
5. Paste into `src/correlationData.ts`, replacing everything from the opening `{`
   after `export const correlations: CorrelationResult =` through the final `};`.
   Keep the `import type` line and the three exported types above it — the pasted
   JSON is only the object literal.
6. **Set `analyze` back to `'OFF'`.** This is a release gate: the `/commit` scan
   refuses to proceed while it is anything else. Leaving it on is the single
   easiest mistake to make here, because nothing in the app misbehaves.
7. `npx tsc --noEmit`, `npx eslint src/`, `npm run build`.

## What bounds the simulation, regardless of the archive

Three constants decide what a run actually sees. None of them are obvious from
the output:

- **`oldestDate` in `runSimulation`** (`src/picksOptimizer.ts`) is hardcoded.
  Archived days before it are skipped no matter how far back `history/` goes.
  There is a second, independent copy of the same cutoff in the historical audit
  path higher up the file.
- **`correlationPercent`** (`src/App.tsx`, currently `0.999`) decides which
  near-top candidate groups count toward a combo pattern's observations. Lowering
  it widens the sample per pattern and changes every factor.
- **`resolvePoolKey`** buckets by the number of games on the slate — `1`, `2`,
  `3`, `4+`. The `'all'` bucket is still generated but nothing reads it.

## If the regenerated table comes out identical

That is the expected result, not a failure, whenever **both** inputs are
unchanged: the same archived days and the same derivation code. The pipeline is
deterministic, so an identical paste leaves `git status` clean and is a decent
confirmation that the process ran correctly end to end.

So before concluding a run did nothing, check which of the two you actually
changed:

- Added game days to `history/`? The factors should move.
- Changed how `Correlation.calculate` derives a factor? The factors should move.
- Neither — only set `analyze` and ran it? Byte-identical output is correct.

The derivation lives in `Correlation.calculate` in `src/picksOptimizer.ts`: it
divides each combo pattern's mean outcome by the baseline pattern's mean. Editing
how factors are *applied* (`applyCorrelation`, same file) does **not** change the
table — application and derivation are separate steps, and only the second one is
baked into `correlationData.ts`.

## Two things that are easy to get wrong about the counts

`this.strategy.count[combo]` is **not** a number of candidate pick-combinations. Each
simulation item contributes at most 1, because `ResultTotal.normalize` collapses its
count to 1 before the item is folded in. So the count is "how many separate
day × slot × book items did this pattern appear in", and each per-pool bucket is
capped by however many items landed in that bucket. Any threshold on this number can
be unreachable for a bucket rather than merely strict — a floor of 20 empties pools
`2`, `3` and `4+` completely on a 51-day archive.

The `'all'` bucket is far better sampled than any per-pool bucket, because it
aggregates every slate. Nothing reads it — `resolvePoolKey` never returns `'all'` — but
it is the obvious place to look if sparse per-pool patterns ever need a fallback.

## Checklist

- [ ] Decided whether this run needs new archive days at all
- [ ] If extending: range `end` is a completed day, and only the last range was touched
- [ ] Confirmed what `history/history.json` holds, not just what `$datesTotal` lists
- [ ] `analyze` set to `'GENERATE'`, page loaded, data visible before the dump appeared
- [ ] Remembered a table-wide diff is expected only if an input really changed
- [ ] Pasted as JSON via **Copy object**, import and type exports preserved
- [ ] `analyze` back to `'OFF'`
- [ ] `tsc`, lint and build clean
- [ ] If the diff is empty, confirmed that an input really did change
