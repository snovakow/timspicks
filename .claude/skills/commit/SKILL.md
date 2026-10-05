---
name: commit
description: Review and finalize everything since the last version commit for pushing. Fixes messages and site mentions, updates the README and docs where needed, commits it all, ends with a version commit, and lists what to copy to the live server.
disable-model-invocation: true
argument-hint: "[x.y.z]"
model: opus
effort: max
allowed-tools: Read, Edit, Write, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git rev-parse:*), Bash(git rev-list:*), Bash(git ls-files:*), Bash(git config user.name), Bash(git fetch:*), Bash(git add:*), Bash(git commit:*), Bash(git rebase:*), Bash(git stash:*), Bash(npm version:*), Bash(npm run lint:*), Bash(npm run build:*), Bash(php -l:*), Bash(node .claude/skills/commit/scripts/scan.mjs:*)
---

# Commit a reviewed, versioned batch

Arguments: $ARGUMENTS

This repo is public: whatever gets pushed (code, comments and commit messages) stays public. The user commits ad hoc while working and runs this skill when a batch is ready to go. Review everything since the last version commit, fix what can still be fixed, commit all of it, and finish with a version commit. The user pushes; never push.

## How the pieces fit

- **Baseline.** A version commit is the review checkpoint: everything before the newest one has been reviewed. Only this skill writes version commits. The scan counts a commit as one only if all of these hold:
  - its whole message is exactly `Version X.Y.Z`, with no body and no trailer
  - its author is snovakow
  - it changes exactly `package.json` and `package-lock.json`, nothing more or less
  - the version in `package.json` matches the message

  Everything after the newest such commit is under review, however much a commit looks like a version commit. A subject that mentions "version", a bump made by hand, or `Version X.Y.Z` with a trailer are all ordinary range commits. Before the first version commit exists, the baseline is the newest pushed commit.
- **Rewriting.** A commit can be rewritten only if it comes after the baseline and isn't reachable from any remote branch, because rewriting a pushed commit would take a force push. The scan prints this rewrite base. Pushed commits in the range are still reviewed, and their problems reported.
- **Order.** Plan the batch before staging anything. Fixes to existing commits come first, then new commits, then the prose commits — README and `docs/` — if any are needed. The version commit always comes last.

## 1. Survey

Run `git fetch --quiet` so pushed/unpushed status is current (skip it if offline). Then run:

    node .claude/skills/commit/scripts/scan.mjs

The **Attention** section lists anything that needs the user. Stop and ask about these:
- a rebase, merge or cherry-pick in progress
- a detached HEAD
- a branch behind its upstream
- being on `main` (work normally lands on `development`)
- a git user other than snovakow (the version commit wouldn't count)
- a version changed outside this skill, where `package.json` no longer holds the baseline's version. Ask whether to undo that change or to pass the intended version as the argument.

The release-check items there are covered in step 2. If nothing is new since the baseline, say so and stop.

## 2. Review the range

Read each range commit with `git show`, the working-tree diff (`git diff HEAD`), and every untracked file. Look for:
- site names and links (step 3)
- secrets, tokens or credentials being added (step 2a)
- files that shouldn't be tracked: data dumps, logs, build output, local settings
- leftovers that look accidental, such as stray debug output

The scan's release checks catch four mistakes that are easy to ship. Ask before committing if one trips:
- `analyze` in `src/features.ts` isn't `'OFF'`. `GENERATE` and `OUTPUT` run simulation and analysis in the app.
- `$savesrc` in `public/fetch_service.php` is `true`, which writes raw feed dumps on the server.
- A History `'end'` date in `public/fetch_service.php` is today or later. An unfinished day gets recorded as done and is never fetched again.
- A call into `public/fetch_lib.php` passes the wrong number of arguments. `update.php` is the one that matters: it lives in its own tree, is deployed separately, and `php -l` can't see across files, so a mismatch reaches the server and fatals in whichever branch runs.

Feature-flag changes in the range go in the report even when they're intended.

Run the checks that match what changed, and ask before committing if one fails in a touched file:
- Frontend files (`src/`, `index.html`, `vite.config.ts`, dependencies): `npm run lint` and `npm run build`. The build is what the server runs, so a failure here is a failed deploy later.
- PHP: `php -l <file>` with a local PHP CLI if one is available; it may not be on PATH.

## 2a. Credentials and copied session data

The scan's **Secrets and session data** section flags added lines that carry a credential or a
browser session. Anything it lists is an Attention item: stop and ask before committing.

The scrapers are meant to look like a browser, so `accept`, `user-agent`, `referer` and the
`sec-ch-ua` headers belong in the code, as do the endpoint URLs and their embedded app ids. What
doesn't belong is anything copied from a real signed-in session, because it carries the ids of
whoever copied it and the public history keeps them forever:
- a Cookie header or `CURLOPT_COOKIE` line, which also holds ad-click, consent and fingerprint ids
- `traceparent`, `tracestate`, `x-correlation-id` and the `x-datadog-*` headers
- any authorization header, bearer token, API key or private key

A request usually works without them. Check with a throwaway script in the scratchpad that runs the
same request with and without the line, and compare the response, rather than guessing. Remove what
isn't needed. When one genuinely is needed, say so in the report instead of committing it quietly.

The check reads only added lines after the baseline, so it says nothing about credentials already
in the code; it also skips this skill's own files, which spell out the patterns. Values never reach
the output, so a hit shows the pattern and a masked line. Investigate by opening the file.

## 3. No site names or links

The user doesn't want outside websites named or linked in anything that becomes public prose. Prose means commit messages, plus comments, docs and explanatory UI text added in the range. The rule is strict: no websites, sportsbooks, leagues, data sources, tool sites or forums, and no URLs, domains or markdown links. Check each commit's own diff, not only the end result, because the history is public too.

Describe things in the app's own terms:
- The books are `bet1`–`bet4`, as in `SportsbookKeys` and `updateBet1`–`updateBet4`. So: "Fix bet2 event-page parsing".
- "the schedule feed" (`games.json`), "the pick-list feed" (`helper.json`), "the challenge".
- Where data came from: "recovered closing lines", "an odds archive".

Code the app needs in order to work isn't prose. Endpoint URLs, the `Sportsbooks` titles, logo files and existing identifiers stay. List any new site or brand names the code introduces in the report, so the user sees them. SVG `xmlns` URIs and the attribution trailer aren't mentions.

The scan's **Links and domains** section finds URLs and domains mechanically. Names written as plain words ("pulled from SomeSite") need your reading, so go through **Prose to read** and every message yourself. Rewrite incidental mentions without asking. If something looks deliberate, such as a README link or a link in the UI, ask instead of deleting it. Never touch commits before the baseline, or pushed commits.

## 4. Messages

Match the style already in the history:
- Subject: capitalized, imperative or a short noun phrase, at most 72 characters, no trailing period, no `feat:`-style prefix. Say what changed, not which file changed.
- Body, when it helps: a blank line, then why, wrapped at 72.

Rewrite a range message only in these cases, and leave good messages alone:
- it names a site
- it has a file-name or vague subject ("Update App.tsx", "wip", "fix")
- it doesn't match its diff

Keep each commit's author. New commits other than the version commit end with the attribution trailer this session uses. Reworded commits keep the trailers they already have.

No other commit's subject may start with `Version` and a number, because the baseline depends on that pattern being unique. Reword an unpushed one to describe what it actually changed.

## 5. README

Update README.md if the range adds or changes something it describes, or something a reader would want to know: a feature, a setting, how picks are ranked, setup or deploy steps, or season details the user has provided. Skip it for fixes, refactors, data ranges and styling.

Keep its voice, follow step 3 for anything you add, and leave the external link list and the
template section as they are. The Documentation list is part of what you maintain: keep it pointing
at whatever `docs/` holds. Never invent results. The README change is its own commit, after the
code and before the version commit.

## 5a. The pages under `docs/`

They are generated prose this skill maintains, the same as README.md. Update any page the range
outdates, and hold every page to the rule below.

**A doc explains the idea, never the code.** A page that states what the code *is* goes wrong
silently on the next rename, value change or flag flip, and nothing checks it. So a page carries
what a reader can't recover from the source — why a rule exists, what breaks without it, what was
measured — and leaves the code as the only record of itself. Out of every page:
- identifiers: file paths, and function, type, constant or variable names
- values that live in the code: periods, thresholds, limits, cutoffs
- counts of code entities, and which flags or settings are currently set how
- a table that mirrors the file tree, such as a source map

Values the code doesn't own stay, since no rename can falsify them: the contest's rules and rewards,
what a feed returns, what the archive measures, and the names of the files on disk that the server
writes. Date a measurement so a reader can judge it.

**Keep the reason a value was worth printing.** Cutting the digits shouldn't cut the warning with
them. A threshold nobody calibrated earns a sentence saying exactly that; the number itself is one
grep away.

**The two runbooks may name what a step needs.** They are `docs/deployment.md` and
`docs/history-and-correlation.md`, the pages whose steps get executed. Their steps may name the one
setting or file a step would be unfollowable without, and the value a step tells you to set, since
that value *is* the step. A value the prose merely describes — a period, a threshold, a limit —
stays out either way, and their explanatory passages follow the rule above in full. Every other page
is strict throughout. Where a runbook owns an executable detail, an explanatory page describes it
instead of repeating it. The scan holds the same two paths; a new runbook goes in both places.

The scan's **Docs** section is the worklist: the code references found per page, runbook pages
counted separately, and dangling paths, where a page names a file that no longer exists.

## 6. Version

- **Number.** Add 1 to the last number of the last version commit's version (`0.0.1` → `0.0.2`). The first one goes from `package.json`'s `0.0.0` to `0.0.1`. If the arguments contain a version like `0.1.0`, use exactly that, and ask if it isn't higher than the current one. Treat any other words in the arguments as hints for the messages.
- **Set it** with `npm version <x.y.z> --no-git-tag-version`. That updates `package.json` and `package-lock.json` without tagging or committing.
- **Commit** just those two files, with the message `Version X.Y.Z` and nothing else: no body, no trailer, author as configured. It's the last commit.

## 7. Plan the commits

Decide the whole batch before staging anything. Take the scan's **Working tree** list, assign every
path to a group, and give each group its subject. That plan is what step 8 executes, in order.

- **One concern per commit.** A group is a change someone would describe in one sentence: a fix, a
  feature, a doc update, a dependency bump. Unrelated work in the same batch gets its own commit,
  however small it is.
- **The file is the unit.** Splitting hunks needs an interactive `git add -p`, which isn't available
  here, so two unrelated changes inside one file can't be separated. Commit the file once and cover
  both in the message, or ask whether to hold one back.
- **Order so every commit stands on its own.** Code before the docs describing it, a helper before
  its caller, so no commit mid-batch leaves the build broken.
- Reword-only and fix-only work isn't a group; it belongs to step 8.2.

If the batch is a single concern, say so and make one commit. Don't split a coherent change to look
tidy.

## 8. Apply

1. Note `git rev-parse HEAD`; the report gives it as the undo point.
2. Fix the rewritable commits first, before new commits bury the tip.
   - **The tip:** stage the fixed files, then run `git commit --amend -F <message file>`. For a message-only change, use `git commit --amend --only -F <message file>`, which leaves the index alone.
   - **An older commit, content fix:** edit, stage only the fix, and run `git commit --fixup=<sha>`.
   - **An older commit, message fix:** write `amend! <sha>`, a blank line and the new message to a file, then run `git commit --allow-empty --only -F <file>`.
   - **Then fold the fixups in:** `GIT_EDITOR=true git rebase --autosquash --autostash <rewrite base>`. Check afterwards that the `fixup!` commits are gone, because an older git (2.37, for one) ignores `--autosquash` unless the rebase is interactive: it reports success, rewrites nothing and leaves them sitting at the tip. If that happens, run `GIT_SEQUENCE_EDITOR=true GIT_EDITOR=true git rebase -i --autosquash --autostash <rewrite base>`, which honours it and still needs no editor.
   - If the rebase stops on a conflict, run `git rebase --abort` and ask. If a merge commit sits anywhere but the tip, report it and ask rather than flatten it. If a fix touches a file that also has uncommitted edits, `git stash push --include-untracked` first and `git stash pop` after.
   - Keep message files outside the repo (the session scratchpad if there is one), so they never get committed.
3. Fix site mentions in the working-tree changes.
4. Commit the groups from step 7, in the planned order. Stage explicit paths, never `-A` or `.`, and check `git diff --cached --stat` against the group's subject before committing: if something unrelated is staged, unstage it rather than widen the message. Commit untracked files that belong to the project and ask about the rest. Never delete the user's files or edit `.gitignore` without asking.
5. Make the prose commits, if steps 5 and 5a call for them: README and `docs/`, one concern each.
6. Make the version commit.

## 9. Verify and report

Run the scan again. Check that:
- `git status` is clean
- the new version commit shows as the baseline
- the only links left are code endpoints

Reread the final messages.

Then report, briefly:
- the commits made, and rewritten commits as old → new sha with what changed
- problems in pushed commits that couldn't be fixed
- the version change, and any feature-flag changes
- new site or brand names in code, files left uncommitted, and the checks that ran
- anything in `docs/` that step 5a couldn't settle, such as a claim only the user can confirm
- the starting sha (the undo point, also in the reflog), and that nothing was pushed
- how far `origin/main` is behind this branch, and whether main has commits this branch lacks, as a reminder to merge before the server pulls
- last, the scan's live update list:
  - whether the built frontend needs a rebuild, and its server steps
  - the individual files to copy, and where
  - what needs no update

  Mention that PHP changes reach the cron only once copied. `dist/data`, `dist/history`, `dist/players` and `dist/auth.json` are never copied, because the server writes the live copies.
