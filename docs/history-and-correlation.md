# History and the correlation lifts

The correlation lifts the app ships are not written by hand. They are fitted to
the day-by-day archive the server keeps, by a run inside the app. This is the
order things have to happen in, and the traps that make a regeneration look like
it worked when it did nothing.

## Two different kinds of generated data

|  | the history archive | the fitted lifts |
| --- | --- | --- |
| Holds | one JSON file per game day: pick lists, odds, who scored | two correlation lifts fitted to that archive, and what they were fitted on |
| Written by | the **History** action on the admin page | pasted in by hand from a console dump |
| Owned by | the server | the repo |
| In git | no — the archive is gitignored | yes, it is committed source |

So a regeneration has two halves that are easy to confuse: extending the
**archive** (new game days), and refitting the **lifts** to whatever the archive
already holds. Only the second one changes a committed file.

## Step 1 — extend the archive, if you want newer days

Skip this entirely when refitting to the days already on disk.

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

## Step 2 — refit the lifts

1. Set `analyze` to `'GENERATE'` in `src/features.ts`. That arms a single
   fitting run, fired once after the page's data has initialized.
2. `npm run dev`, open the page, and wait for the odds tables to appear. The
   run does not start until the live data has loaded, because it runs off the
   same initialization path.
3. The console logs one object: the two lifts, then the first and last day they
   were fitted on and how many days and player-days that covers.
4. Copy that object as text — in the browser devtools, right-click it and choose
   **Copy object**. Expanding and selecting it by hand gives you the devtools'
   display form, not valid JSON.
5. Paste into `src/correlationData.ts`, replacing the whole exported object
   literal. Keep the comment and the exported type above it — the pasted JSON is
   only the object.
6. **Set `analyze` back to `'OFF'`.** This is a release gate: the `/commit` scan
   refuses to proceed while it is anything else. Leaving it on is the single
   easiest mistake to make here, because nothing in the app misbehaves.
7. `npx tsc --noEmit`, `npx eslint src/`, `npm run build`.

## Check what the run saw

The pasted object records what the lifts were fitted on, so compare its last day
and day count with the archive before trusting it. A run on the development
server reads the checkout's own copies of the archive and the slot snapshots,
which can lack days the live folder holds. A day without its snapshots drops out
of the fit without an error; the day count is the only sign. The analyze skill
fits the lifts to the full archive and names any shipped value that differs.

## What bounds the fit, regardless of the archive

Three choices decide what a run actually sees. None of them are obvious from the
output:

- **A hardcoded earliest date.** Archived days before it are skipped no matter
  how far back the archive goes, and there is a second, independent copy of the
  same cutoff in the historical audit path. Extending the archive backwards can
  therefore change nothing at all.
- **The Books setting the page starts with.** A player counts only when enough
  books price them for an average, so changing that default changes which
  players the fit sees.
- **One price per player a day.** Each player counts once a day, at their
  average price in the day's first slot that lists them with one. Later slots
  add only players not counted before.

## If the refitted lifts come out identical

That is the expected result, not a failure, whenever **both** inputs are
unchanged: the same archived days and the same fitting code. The fit is
deterministic, so an identical paste leaves `git status` clean and is a decent
confirmation that the process ran correctly end to end.

So before concluding a run did nothing, check which of the two you actually
changed:

- Added game days to the archive? The lifts and the days they cover should move.
- Changed how the lifts are fitted, or one of the bounds above? The lifts should
  move.
- Changed the points table, or how the lifts value a ticket? Nothing should
  move. The fit counts only who scored together and at what prices, and applying
  the lifts is a separate step that the committed values don't depend on.
- Neither — only armed the run and ran it? Byte-identical output is correct.

## What the lifts measure

Each lift is how many times as often two players from one game both scored as
their odds say — teammates for one lift, opponents for the other — measured
against the same day's pairs from different games. Those pairs can't be
correlated, so they carry only the books' margin, and comparing within a day
cancels it. The margin drifts from day to day, so pooling the raw counts across
days instead reads below 1 even with no correlation at all. The days are pooled
by Mantel-Haenszel.

The fit uses every listed pair, though the picks come from near the top of the
lists. The analyze skill checks whether the lifts hold there: on 2026-10-17, over
the archive through 2026-10-15, the near-top pairs' lifts did not differ
significantly from the rest.

## Checklist

- [ ] Decided whether this run needs new archive days at all
- [ ] If extending: the range end is a completed day, and only the last range was
      touched
- [ ] Confirmed what the local index holds, not just what the range table lists
- [ ] `analyze` set to `'GENERATE'`, page loaded, data visible before the dump
      appeared
- [ ] The dump's last day and day count match the archive
- [ ] Remembered the lifts should change only if an input really changed
- [ ] Pasted as JSON via **Copy object**, the comment and type export preserved
- [ ] `analyze` back to `'OFF'`
- [ ] Type-check, lint and build clean
- [ ] If the diff is empty, confirmed that an input really did change
