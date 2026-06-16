# State, Pause, Resume & Recovery

A clone is a long job. The user must be able to **pause** it, **come back
later** (even in a brand-new session after a usage-limit cutoff), and have the
team **resume from exactly where it stopped** — never redoing finished work.
This is a first-class feature, not an afterthought. It rests on two pillars:

1. **A durable on-disk state file** (`.clone-team/state.json`) plus the built
   artifacts themselves (spec files + component files on disk). This survives
   anything — session loss, crashes, machine restarts.
2. **The Workflow's native `resumeFromRunId`** for fast same-session resume.

The durable file is the source of truth. `resumeFromRunId` is an optimization on
top of it. When they disagree, trust the disk.

## Usage watchdog — soft stop / hard stop / auto-wake (graceful wind-down before a cutoff)

A clone run is token-heavy and can outlast the account's **5-hour usage window**.
Rather than let agents die mid-thought at the cutoff, `scripts/usage-watchdog.mjs`
winds the team down *gracefully before* the limit hits. It polls the same endpoint
the `/usage` screen reads (zero tokens, pure node — no model) and writes sentinel
files into `.clone-team/` at two thresholds:

| Sentinel | Default | Meaning for agents |
|---|---|---|
| `WRAP_UP` | ≥ 80% | **Soft stop.** Start no new major step; finish the current atomic step only if minutes from done; write a handoff report; return `wrappedUp: true`. |
| `HARD_STOP` | ≥ 90% | **Hard stop.** Stop immediately, even mid-step; flush the handoff as-is; return `wrappedUp: true`. |

The Manager launches it in the background at the top of Phase 2:

```bash
node "<SKILL_DIR>/scripts/usage-watchdog.mjs" start --dir <proj>   # run_in_background (poller)
node "<SKILL_DIR>/scripts/usage-watchdog.mjs" check --dir <proj>   # one-shot poll (prints utilization + resets_at)
node "<SKILL_DIR>/scripts/usage-watchdog.mjs" resets-at --dir <proj> # print resets_at for the auto-wake timer
node "<SKILL_DIR>/scripts/usage-watchdog.mjs" clear --dir <proj>   # remove sentinels
```

**How the signal reaches the running team** (background agents are reachable only
pull-based): every agent prompt carries a **wrap-up protocol** (injected into the
shared CONTEXT by `workflows/clone-build-loop.js`, so it reaches every agent even
when the Manager overrides a persona). Agents check for the sentinels at task
start and between major steps — a free file-existence test. On a trip the agent
writes `docs/research/components/<slug>.handoff.md` (TARGET / DONE / REMAINING /
NEXT STEP / punch list), flushing all in-context findings to disk, and returns
`wrappedUp: true`. The Workflow then **drains** (the `call()` wrapper): nothing new
launches, in-flight sections return `status: 'deferred'`, assembly is skipped, and
the run ends cleanly with `state.json` accurate (`summary.drained` +
`summary.deferred` name what to resume). The same drain triggers if an agent dies
on a terminal API error (`agent()` returns `null`), so an API outage also stops
burning tokens instead of thrashing.

**Auto-wake.** The sentinel files record `resets_at`. When a run drains, the
Manager reads it (`resets-at`, or the `resetsAt` field in `.clone-team/HARD_STOP`)
and sets a one-shot timer for just after that time — a scheduled `/clone-resume`
(via `/schedule` or a cron). When the 5-hour window resets, the team relaunches
from the handoffs automatically; no human needs to be watching the clock. If no
scheduler is available, surface the reset time to the user so they can say
"continue" then.

A failed poll is logged and ignored (never treated as 0%); when utilization drops
below the soft threshold (a new window) the watchdog clears the sentinels itself,
and `state.mjs reconcile` also clears them on resume so a relaunched loop is never
re-tripped by a stale file before the next poll. The endpoint is undocumented —
if it ever changes shape, the watchdog degrades to logging errors and the run
simply loses early warning (it still resumes durably from disk).

## `.clone-team/state.json` schema

Write this from the very first Phase-0 answers, and update it whenever anything
material changes (a section finishes, a run launches, the user pauses).

```json
{
  "version": 1,
  "goal": "Pixel-perfect clone of https://example.com plus architecture docs",
  "targetUrl": ["https://example.com"],
  "stack": "Next.js + Tailwind v4 + shadcn/ui",
  "projectDir": "/abs/path/to/clone-project",
  "credsFilePath": ".clone-team/creds.local.json",
  "loginQuirks": "SSO via Google; dismiss cookie banner first",
  "appInsights": "Dashboard data loads lazily on scroll",
  "runConfig": {
    "modelTier": "max-fidelity",
    "autonomy": "autonomous",
    "maxRounds": 4,
    "finalCap": 3,
    "backendDepth": "inferred"
  },
  "paths": {
    "research": "docs/research",
    "components": "docs/research/components",
    "designRefs": "docs/design-references"
  },
  "phase": "build",                       // setup | recon | foundation | build | assemble | done
  "lastRunId": "wf_ab12cd34",            // for same-session resumeFromRunId
  "foundation": { "done": true, "buildPasses": true },
  "sections": [
    {
      "name": "Hero",
      "targetFile": "src/components/Hero.tsx",
      "screenshot": "docs/design-references/hero-1440.png",
      "interactionModel": "scroll-driven",
      "complexity": "moderate",
      "dependsOn": [],
      "specPath": "docs/research/components/hero.spec.md",
      "status": "done",                   // pending | spec | building | built | flagged | done
                                          // 'built' = file on disk, not yet Tester-approved → test-first re-validate
      "rounds": 2
    }
  ],
  "backend": { "status": "in-progress", "docPath": "docs/research/ARCHITECTURE.md" },
  "flagged": [],
  "updatedAt": "2026-06-04T00:00:00Z"
}
```

`scripts/state.mjs` provides helpers so the Manager never hand-edits JSON:

```bash
node scripts/state.mjs init      --dir <projectDir> --goal "..." --stack "..."   # create
node scripts/state.mjs get       --dir <projectDir>                              # print state
node scripts/state.mjs status    --dir <projectDir>                              # human summary
node scripts/state.mjs set-phase --dir <projectDir> --phase build
node scripts/state.mjs set-run   --dir <projectDir> --run-id wf_ab12cd34
node scripts/state.mjs add-section    --dir <projectDir> --json '{"name":"Hero", ...}'
node scripts/state.mjs mark-section   --dir <projectDir> --name Hero --status done --rounds 2
node scripts/state.mjs reconcile --dir <projectDir>                              # sync state<->disk before resume (see below)
node scripts/state.mjs remaining --dir <projectDir>                              # JSON: not-done sections (feed to Workflow args)
```

Keep the helpers as the interface — they stamp `updatedAt` and keep the file
valid. (Time is read from the OS in the helper, never inside the Workflow
script, where clocks are unavailable.)

## Secure credentials pattern

Logins are common (cloning a site behind auth). Handle creds carefully:

- Store them in **`.clone-team/creds.local.json`**, which is **gitignored**
  (the repo's `.gitignore` already excludes `.clone-team/`).
- **Never** commit creds, print them to the chat, write them into reports, or
  bake them into the Workflow `args` in plaintext. Pass agents the **file path**
  (`credsFilePath`), and the agents read it themselves at login time.
- Only clone sites the user is **authorized** to access. If a site's terms
  forbid scraping/cloning, surface that to the user before proceeding.
- When you log in via `agent-browser`, prefer reading the value at the moment of
  typing; don't echo it back in observations or screenshots of the password
  field.

```json
// .clone-team/creds.local.json  (gitignored — example shape)
{ "loginUrl": "https://example.com/login", "username": "...", "password": "...", "notes": "SSO; click 'Continue with Google'" }
```

## The three commands

These live in `commands/` and call the same logic. The Manager also treats a
plain "pause" / "continue" / "where are we?" as these commands.

### `/clone-status`
Read `state.json` and report: current phase; sections done / in-flight /
pending / flagged; backend-doc status; the `lastRunId`; and the next action.
Run `node scripts/state.mjs status --dir <projectDir>`.

### How a section becomes `done` (durable checkpointing — wire this up)

The Workflow script runs in a sandbox with **no filesystem access**, so it
cannot mark `state.json` itself. The durable `done` flag must therefore be
written by an **agent**, and to preserve the two-gate guarantee it must be the
**Tester** — and only on an **OK** verdict. The Manager bakes this into the run
(via the persona/`appInsights` protocol):

> **Tester, on a passing section:** the moment your verdict is `OK`, run
> `node <repo>/scripts/state.mjs mark-section --dir <projectDir> --name <slug> --status done --rounds <n>`.
> Never mark `done` on `NG`. This is what lets a crash/usage-cutoff resume
> without redoing approved sections.

Because the FE Developer has already written the `targetFile` to disk before the
Tester approves, a `done` mark always coincides with an on-disk component —
exactly the invariant `state.mjs remaining` reconciles against. Without this
marker, every crash re-runs **all** sections (the failure this checkpointing
prevents). If a run somehow ends with on-disk, build-passing components that were
never marked (older runs), the Manager may reconcile them at resume — but the
Manager's Phase-3 final regression is the backstop that re-verifies everything.

### `/clone-pause`
1. If a Workflow is running, `TaskStop` it (use the `lastRunId` / the running
   task). In-flight section work is abandoned for this run — that's fine,
   because only **Tester-approved, on-disk** sections are marked `done`; a
   half-built section simply re-runs on resume.
2. Make sure `state.json` reflects reality (sections that actually finished are
   `done`; everything else is `pending`/`building`).
3. Tell the user how to resume (`/clone-resume`, or just "continue").

### `/clone-resume`
1. Read `state.json`; re-establish context (goal, stack, creds path, paths).
2. **Reconcile with disk — run `node scripts/state.mjs reconcile --dir <projectDir>`.**
   This encodes the resume rules in code so they can't be skipped:
   - fills each section's `specPath` from disk when `<components>/<name>.spec.md`
     exists → the loop **never re-extracts** a section it already spec'd;
   - marks any section whose `targetFile` exists but was never Tester-approved as
     **`built`** → the loop **test-first re-validates** it (runs the Tester before
     any rebuild; rebuilds only on NG) instead of throwing away a possibly-good
     file;
   - demotes a `done` section whose `targetFile` is missing back to `pending`;
   - **rebases a stale `projectDir`** to where `state.json` actually lives (so a
     moved/renamed project doesn't silently drive agents at a dead path).
   Re-testing a `built` section is cheap insurance against shipping a half-built one.
3. Resume the loop:
   - **Same session** and `lastRunId` still valid → relaunch the Workflow with
     `resumeFromRunId: lastRunId` (fast; cached calls return instantly).
   - **Otherwise** → compute the remaining work with
     `node scripts/state.mjs remaining` and launch the Workflow fresh with only
     the not-done sections (the durable, journal-independent path).
4. Record the new `runId`, set phase, and let it run.

## Recovery from a usage-limit cutoff (the worst case)

This is why the durable file exists — and why the watchdog above front-runs it.
The usage cutoff is now a **graceful wind-down**, not a crash: at ≥80%/≥90% the
team flushes handoffs and the Workflow drains, then the Manager auto-schedules a
`/clone-resume` for just after `resets_at`. But even if the session is killed
outright (no graceful drain), nothing is lost:

- Nothing approved is lost — done sections are on disk and marked `done`; a
  drained section left a handoff its resumed agent continues from.
- A new session starts the skill, the Manager runs `/clone-resume` (or the
  auto-wake timer fires it), the durable path kicks in, and only the unfinished
  sections rebuild.
- The backend-doc track is idempotent too: if `ARCHITECTURE.md` exists and was
  marked complete, skip it; otherwise re-run the Architect.

The guarantee to give the user: **"You can stop any time. Come back whenever —
even tomorrow, even after hitting your limit — say 'continue', and the team
picks up exactly where it left off without redoing finished sections."**
