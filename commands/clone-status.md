---
name: clone-status
description: Show clone-team progress for the current clone project — phase, sections done/in-flight/pending/flagged, backend-doc status, and the last run id.
argument-hint: "[projectDir]"
allowed-tools:
  - Bash
  - Read
---
Report the current state of the clone-team run.

1. Resolve the project dir: use `$ARGUMENTS` if given, else the current working
   directory. The state file is `<projectDir>/.clone-team/state.json`.
2. Run: `node <clone-team-skill>/scripts/state.mjs status --dir <projectDir>`
   (the skill lives where this command's skill is installed, typically
   `~/.claude/skills/clone-team`).
3. If no state file exists, say so and offer to start a clone with the
   `clone-team` skill.
4. **Check for an active usage cutoff.** If `<projectDir>/.clone-team/HARD_STOP`
   or `WRAP_UP` exists, the run hit the soft/hard stop and is draining/drained —
   read the file's `resetsAt` and tell the user when the 5-hour window resets (and
   that `/clone-resume` after that, or the auto-wake timer, picks up from the
   handoffs).
5. Summarize for the user in a few lines: what phase we're in, how many sections
   are done vs. remaining, any flagged sections needing attention, whether the
   backend doc is complete, and the single recommended next action (resume,
   address a flagged section, or finish).
