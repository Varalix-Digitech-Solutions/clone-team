---
name: clone-pause
description: Pause an in-progress clone-team run cleanly — stop the running build Workflow and flush state so it can be resumed later (even in a new session) with no lost approved work.
argument-hint: "[projectDir]"
allowed-tools:
  - Bash
  - Read
  - TaskStop
  - TaskList
---
Pause the clone-team run safely. Follow `references/state-and-resume.md`.

1. Resolve the project dir (`$ARGUMENTS` or cwd). Read
   `<projectDir>/.clone-team/state.json` and note `lastRunId`.
2. If a build Workflow is running, stop it: find it via `TaskList` (or use
   `lastRunId`) and `TaskStop` it. In-flight, not-yet-approved section work is
   discarded for this run — that's fine, because only Tester-approved sections
   are marked `done` and written to disk; a half-built section simply re-runs on
   resume.
3. Make sure `state.json` reflects reality: sections that actually finished and
   were approved stay `done`; anything that was mid-build goes back to
   `pending`. Use `node <skill>/scripts/state.mjs mark-section ...` as needed,
   and `set-phase` to record where we paused.
4. Confirm to the user: what's done, what's left, and that they can resume any
   time — even tomorrow, even after a usage-limit reset — with `/clone-resume`
   or just by saying "continue".
