---
name: deploy
description: Deploy main to the live site on this machine. Builds main's committed files in a temp folder with npm ci and npm run build, then copies the build into the live folder and update.php into the update folder in the order docs/deployment.md gives, skipping files that already match and never touching the data the server owns. Use when a merged and pushed batch should go live.
disable-model-invocation: true
argument-hint: "[--branch <name>] [--dry-run]"
allowed-tools: Bash(node .claude/skills/deploy/scripts/deploy.mjs:*)
---

# Deploy to the live site

Arguments: $ARGUMENTS

Run the script, passing the arguments through:

    node .claude/skills/deploy/scripts/deploy.mjs $ARGUMENTS

- `--branch <name>`: deploys that local branch's committed state instead of `main`. Nothing else picks the branch: what's checked out, and any uncommitted change, never reaches the live site.
- `--dry-run`: builds and lists what would be copied, and copies nothing.
- `--update <dir>`, `--lib <path>`: overrides for when the folders can't be found from the cron line, the same as `/health-server`'s.

The script does the whole deploy, and it alone writes to the live and update folders. Never copy, move or delete anything there yourself, and don't merge, push, switch branches or run `npm` in the checkout. If the script stops, relay its message and the files it says it copied before stopping, if any, and leave the fix to the user. A permission error writing to the live or update folder comes from this thread's sandbox: suggest running the same command from Terminal.

## Report

Keep it short:
- the branch, commit and version deployed, or that it was a dry run
- any notes it printed, such as unpushed commits, `development` ahead of `main`, or a branch other than `main`
- what it copied, or that everything already matched, and how many older asset files it removed
- the live front-end version it ends on

Then suggest `/health-server` to confirm the deploy. If that survey notes that the checkout's `node_modules` has drifted from the lockfile, its reference build can differ from the deployed one; `npm ci` in the checkout fixes it, and that's the user's call.

The repo is public, so keep hosts and server paths out of anything tracked.
