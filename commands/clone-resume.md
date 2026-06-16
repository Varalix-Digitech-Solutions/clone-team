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
2. **Reconcile with disk.** Run `node <skill>/scripts/state.mjs reconcile --dir
   <projectDir>` — it keeps `done` sections whose `targetFile` exists, marks
   on-disk-but-unverified files `built` for test-first re-validation, demotes
   `done`-without-file to `pending`, and **clears any stale `WRAP_UP`/`HARD_STOP`
   usage sentinels** the drained run left behind (so the relaunched loop isn't
   immediately re-tripped). When unsure whether a half-finished section is
   trustworthy, prefer re-verification — re-testing is cheap insurance.
2.5. **Restart the usage watchdog** — a resume is a fresh Workflow, so it needs
   its own watchdog: `node "<skill>/scripts/usage-watchdog.mjs" start --dir
   <projectDir>` as a **background `Bash`**. Sections deferred by a prior
   usage-cutoff resume from their `docs/research/components/<slug>.handoff.md`
   files automatically.
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
