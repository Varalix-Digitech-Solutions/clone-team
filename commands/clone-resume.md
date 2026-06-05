---
name: clone-resume
description: Resume a paused or interrupted clone-team run from exactly where it stopped — reconciles with disk and relaunches the build Workflow without redoing finished sections. Works across sessions and after usage-limit cutoffs.
argument-hint: "[projectDir]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Workflow
  - TaskList
---
Resume the clone-team run. Follow `references/state-and-resume.md` and
`references/orchestration.md`.

1. Resolve the project dir (`$ARGUMENTS` or cwd) and read
   `<projectDir>/.clone-team/state.json`. Re-establish full context: goal,
   target, stack, creds file path, paths, run-config.
2. **Reconcile with disk.** For each section, if it's marked `done` and its
   `targetFile` exists, keep it `done`; otherwise set it `pending` so the
   enforced loop re-verifies it. When unsure whether a half-finished section is
   trustworthy, prefer `pending` — re-testing is cheap insurance.
3. **Relaunch the loop:**
   - **Same session** with a still-valid `lastRunId` → call the `Workflow` tool
     with `{ scriptPath: "<skill>/workflows/clone-build-loop.js",
     resumeFromRunId: "<lastRunId>" }`. Cached agent calls return instantly.
   - **Otherwise (new session / cutoff)** → compute remaining work with
     `node <skill>/scripts/state.mjs remaining --dir <projectDir>` and launch the
     Workflow fresh with `args.sections` set to only those not-done sections
     (the durable, journal-independent path). Re-pass goal, stack, creds path,
     personas (read `agents/*.md`), and run-config in `args`.
4. Record the new `runId` (`state.mjs set-run`), set the phase, and let it run.
   If the backend doc is incomplete, ensure that track resumes too.
5. Tell the user what's resuming and roughly what's left.
