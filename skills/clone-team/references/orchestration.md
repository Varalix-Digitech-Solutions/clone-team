# Orchestration — the team, the loop, and the Workflow

This is the operating manual for the Manager (the main-thread Claude running the
`clone-team` skill). Read it before Phase 2.

## Why a Workflow, and not "just spawn agents and iterate"

The whole point of the team is that **two gates protect quality** — the Tester
and the Manager — and **nothing ships past both**. If the loop lived only in the
Manager's head, the Manager could (under time/token pressure, or just optimism)
quietly skip the Tester, accept a "looks fine" section, or forget to re-test
after a fix. That is the failure this skill exists to prevent.

So the loop is expressed as a **deterministic `Workflow` script**
(`workflows/clone-build-loop.js`). The script *is* the process. It runs
`extract → spec → develop → full-regression-test → fix → re-test …` as control
flow, so the steps cannot be reordered or skipped by anyone — not the Manager,
not a developer agent, not the model having an off day. The Tester gate is a
`while` loop condition, not a suggestion.

The Manager still owns everything the Workflow can't: talking to the user,
gathering creds and requirements, recon/foundation, launching and steering the
Workflow, the human final regression, and the resume decisions.

> A Workflow runs in the **background** and **cannot talk to the user mid-run**.
> That is the right division: anything interactive (creds, clarifications,
> sign-off in checkpoint mode) happens in the Manager's phases; the autonomous
> grind happens in the Workflow.

## The five-actor model

```
                         ┌─────────────────────────────┐
        user  ⇄  MANAGER (you, main thread, holds /goal)
                         │  Phase 0 requirements + creds
                         │  Phase 1 recon + foundation + section list
                         │  Phase 3 assembly + human final regression
                         └──────────────┬──────────────┘
                                        │ launches + steers
                              ┌─────────▼─────────┐
                              │  WORKFLOW (script) │  enforces the loop
                              └───┬───────────┬────┘
              per section, parallel │           │ in parallel
        ┌──────────────────────────▼──┐   ┌────▼──────────────────┐
        │ extract→spec (extract model)│   │ BACKEND ARCHITECT     │
        │ FRONTEND DEVELOPER builds   │   │ writes ARCHITECTURE.md │
        │ TESTER full-regression gate │   └───────────────────────┘
        │   ↑ NG ──── fix ────┐       │
        │   └── OK ──► done   │       │
        └─────────────────────┴───────┘
                  then: assemble → final regression → fix (enforced)
```

- **Manager** = main thread. Full autonomy, only one who talks to the user.
- **Frontend Developer**, **Tester**, **Backend Architect** = agents the Workflow
  spawns via `agent()`. Their canonical personas are in `agents/*.md`; the
  Workflow embeds tight capsules of the same personas (overridable via
  `args.personas` so the Manager can pass the full files as the single source of
  truth).
- Each agent **loads `ui-pack` first** and drives the real UI through
  `agent-browser`. This is baked into every persona.

## How the Manager launches the Workflow

1. Finish Phase 0 + Phase 1 so `state.json` has: goal, target(s), stack, creds
   file path, login quirks, app insights, the **section list**, run-config, and
   the doc-output paths.
2. Read the three `agents/*.md` files and pass their bodies as
   `args.personas.{fe,backend,tester}` — single source of truth, no drift.
3. Call the `Workflow` tool with `{ scriptPath: "<skill>/workflows/clone-build-loop.js", args: <the object above> }`.
   - Pass `args` as a **real JSON object**. The engine is hardened to also accept
     a **JSON string** (it `JSON.parse`s a string payload) — but never assume:
     the delivery layer has been observed to hand the script a *stringified*
     `args`, which silently dropped the whole config. The script now defends
     against this and **aborts loudly** (`error: 'bad-args'` / `'no-sections'`)
     rather than building nothing.
   - The tool returns immediately with a `runId` and a `task-notification`
     arrives on completion. Record the `runId` in `state.json` — it is the key
     for same-session resume.
4. **VERIFY THE LAUNCH (mandatory — do not skip).** Within ~1–2 min, confirm the
   config actually reached the engine before letting it grind:
   - The startup `log()` line prints `clone-team config: projectDir=… | stack=… |
     sections=N | …`. Confirm `projectDir`/`stack` are **yours**, not the
     defaults (`projectDir=.`, `stack=(stack unspecified…)`), and `sections=N` is
     the real count.
   - Or grep the newest agent transcript for `PROJECT DIR:` — it must show your
     real project path. If it shows `.`, **args did not parse**: stop the run,
     fix the call, relaunch. A run that reaches the assemble step with
     `sections=0` is a **misfire, not a successful empty run** — treat any
     "assembled nothing / blocked" result as a launch bug to fix in the skill,
     never as output to keep.
5. While it runs, you may watch progress with `/workflows`. When the notification
   arrives, read the structured return (sections passed/flagged, final verdict,
   backend coverage) and proceed to Phase 3.

> **Tuning principle.** This skill's purpose is a *reliable process*, not a
> one-off artifact. If something good is produced by a fluke (e.g. a doc an agent
> recovered despite a broken launch), do **not** keep it — fix the process and
> regenerate it through the corrected path. A correct skill is one where a fresh
> run from scratch reproduces the result.

### Resume vs. fresh launch

- **Same session, after a pause or edit:** relaunch with
  `{ scriptPath, resumeFromRunId: <recorded runId> }`. Unchanged `agent()` calls
  return cached results instantly; only new/edited work runs live.
- **New session (e.g. after a usage-limit cutoff):** the in-memory journal is
  gone, so use the **durable path**: rebuild the section list from `state.json`
  marking on-disk, Tester-approved sections as `status: 'done'`, and launch
  fresh. The Workflow skips `done` sections. This is journal-independent and
  always safe. See `state-and-resume.md`.

## Model-tier wiring

The Manager runs in the session model (Opus by default). The Workflow maps the
chosen tier to per-role models:

| Tier | Developer | Tester | Backend | Extraction |
|------|-----------|--------|---------|------------|
| `max-fidelity` (default) | opus | opus | opus | sonnet |
| `cost-optimized` | sonnet | sonnet | sonnet | haiku |
| `ultra-cheap` | sonnet | sonnet | sonnet | haiku |

Always let the **user choose** at Phase 0 (default to `max-fidelity` / Opus, per
the original intent), because cost tolerance differs per user — especially once
this skill is public. Never hard-code the tier.

## Round caps (runaway-spend guard)

- `maxRounds` (default 4): per-section Dev→Tester rounds before the section is
  **flagged** for the Manager instead of looping forever.
- `finalCap` (default 3): assemble→final-regression rounds.
- A flagged section blocks automatic assembly; the Manager decides whether to
  re-dispatch with a tighter spec, split the section, or ask the user.

## Wave size & build-only (crash-resilience on constrained hosts)

- `waveSize` (runConfig, default = all): how many sections build **concurrently**.
  Each section's agents drive their own headless Chrome; on a memory-constrained
  machine, 11 sections × (Opus agents + Chrome) + the dev server can exhaust the
  host and **crash it before any section reaches a checkpoint** — so every restart
  begins again from zero. Waves run sequentially; sections within a wave run in
  parallel. Each completed wave's sections get Tester-marked `done` (durable), so
  a crash resumes instead of restarting.
- **Size the wave to the host — check this parameter BEFORE launching.** Don't
  hardcode it. Run the capacity probe and pass its number as `waveSize`:
  ```
  WAVE=$(node scripts/capacity.mjs --wave)   # e.g. 2 on a ~15GB box, more on a bigger one
  # full report: node scripts/capacity.mjs
  ```
  The probe reads real free RAM (`/proc/meminfo MemAvailable`), cores, and load,
  budgets **~2000 MB per concurrent section** (a heavy animated page drives a
  headless Chrome that balloons to ~1.5 GB alongside its Opus agent) above a
  **~5 GB reserve** (the Claude CLI itself is ~2 GB and the OOM killer loves it,
  plus the dev server + Vite + OS), and returns `recommendedWaveSize =
  min(RAM-fit, cores−2, ceiling)`. Lots of free RAM → a big wave (≈ as many as
  CPU allows); little free RAM → a small wave (often **1–2**). **Use the probe's
  number; never hardcode a guess** — a guessed `waveSize=3` on a RAM-tight box is
  exactly what got the CLI OOM-killed at wave 3. Recalibrate via env
  (`CT_PER_AGENT_MB`, `CT_RESERVE_MB`, `CT_MAX_WAVE`) if you still observe crashes
  (symptom: host reboots ~5–15 min in with **0** components on disk → lower the
  wave / raise per-agent budget).
- `skipAssembly` (runConfig, default false): when true, the Workflow builds +
  Tester-gates sections only and **leaves page assembly to the Manager's Phase 3**
  (the authoritative assemble + final regression). Pair with waved runs so
  intermediate waves don't each try to assemble a partial page.

## The unit of work is a PAGE (not a section)

A large-context, meticulous model (Opus, the default tier) builds a **whole page
in one piece**. That is the right granularity: it keeps backgrounds, text colors,
asset paths, and spacing consistent across the entire page, and it removes the
assembly step where independently-built "approved" sections break against each
other (mismatched bg/text contrast, `../`-relative paths that only resolved in a
preview harness, inconsistent gaps). So the work-list items the loop iterates are
**pages**: a single-page site is a **one-shot** whole-page build; a multi-page
site is **one builder per page** (pages run concurrently, each its own
build→test→fix loop). Split a *single* page into sections only as a fallback for a
genuinely enormous page or a small-context/weaker tier — and even then one agent
owns the whole page so there are no seams. Each builder is told to produce a
**standalone, self-consistent** artifact that is correct on the real assembled
page, not only inside a preview/test harness.

## Parallelism & file-ownership rule

Pages (or, in the fallback, sections) build **concurrently** (the Workflow caps
live agents at `min(16, cores−2)`, and `waveSize` caps it further on
memory-constrained hosts). To keep parallel builders from racing on the same file:

- **Foundation files** (global CSS/tokens, types, icons, shared primitives) are
  built **once by the Manager in Phase 1**, before the loop.
- **Each section writes its own distinct component file** (`targetFile`). Give
  every section a unique `targetFile` in the section list.
- If two sections genuinely must touch the same file, either merge them into one
  section or run them with `isolation: 'worktree'` (set it in the script for
  those agents) and merge afterward. Prefer distinct files — it's simpler and
  avoids merge cost.

## Checkpoint (non-autonomous) mode

If the user chose **checkpoint-at-gates** instead of fully autonomous, don't run
the whole loop headless. Instead drive it section-by-section: launch the Workflow
for a small batch (or one section), report the Tester verdict to the user, get
sign-off, then continue. The same script supports this — just pass a subset of
`sections` per launch and keep the rest `pending` in `state.json`.
