# CLAUDE.md — clone-team skill repository

This repo **is** a Claude Code skill: `clone-team`. It orchestrates a team of
agents to clone any website into a pixel-perfect UI **and** produce thorough
architecture documentation. It's intended to be installed into
`~/.claude/skills/clone-team/` and published open-source.

If you're Claude working *on this repo* (developing the skill), read this. If
you're Claude *using* the skill to clone a site, the entry point is `SKILL.md`.

## What this skill is, in one breath

The **Manager** (the main-thread Claude running `SKILL.md`) gathers requirements
and credentials interactively, does recon + foundation, then launches a
**deterministic background `Workflow`** that enforces, per section:
`extract → spec → develop → full-regression-test → fix → re-test …` until the
**Tester** gate passes — with a **Backend Architect** documenting the system in
parallel. The whole run is **pausable and resumable** (even across sessions /
after usage-limit cutoffs) via a durable `state.json`.

The two deliverables, always: **(1) an exact UI clone**, **(2) `ARCHITECTURE.md`**.

## Why a Workflow (the core design decision)

The loop is a JS `Workflow` script, not Manager discretion, **so the Tester gate
cannot be silently skipped.** The script *is* the process: the Tester check is a
`while`-loop condition. This is the single most important property of the skill —
don't "simplify" it back into "spawn some agents and iterate," which is exactly
the failure mode (skipped tests, accepted "looks fine" sections) it prevents.

A Workflow runs in the background and can't talk to the user mid-run, so the
division is deliberate:
- **Interactive** (creds, requirements, clarifications, checkpoint sign-off,
  resume decisions, human final regression) → the **Manager** in `SKILL.md`.
- **Autonomous grind** (the build/test loop, backend docs) → the **Workflow**.

## File map

```
SKILL.md                          # the Manager playbook (entry point)
agents/
  frontend-developer.md           # builder persona (canonical)
  tester.md                       # the gate persona (canonical)
  backend-architect.md            # docs persona (canonical)
workflows/
  clone-build-loop.js             # the enforced loop (the engine)
references/
  orchestration.md                # team model + how to launch/steer the Workflow
  state-and-resume.md             # state.json schema, creds pattern, pause/resume/recovery
  extraction-playbook.md          # recon/extraction scripts + spec template
  backend-doc-template.md         # ARCHITECTURE.md structure
scripts/
  state.mjs                       # durable state CLI (init/status/mark-section/remaining/…)
  capacity.mjs                    # host-capacity probe -> recommended waveSize (check before launch)
commands/
  clone-status.md / clone-pause.md / clone-resume.md
evals/
  evals.json                      # skill-creator test cases
```

## Conventions & invariants (don't break these)

- **Single source of truth for personas.** The canonical personas are in
  `agents/*.md`. The Workflow embeds tight capsules of the same text but accepts
  `args.personas.{fe,backend,tester}` overrides — the Manager reads the agent
  files and passes them in, so there's one source. If you edit a persona, edit
  the `agents/*.md` file.
- **Every agent loads `ui-pack` first** and verifies via `agent-browser`. This is
  baked into every persona; keep it there.
- **Two gates, never one:** Tester (in the loop) then Manager (final). Approved
  work only.
- **Resumability rests on disk.** A section is `done` only when Tester-approved
  AND its `targetFile` exists. `state.mjs remaining` reconciles state with disk —
  that reconciliation is what makes cutoffs survivable. Don't add a code path
  that marks `done` without the file existing.
- **Model tier is user-chosen**, defaulting to `max-fidelity` (Opus for
  Manager/Dev/Tester). Never hard-code a tier — offer it at Phase 0.
- **Credentials** live in the gitignored `.clone-team/creds.local.json`; agents
  get the *path*, not the values. Never commit, print, or embed creds.
- **Foundation files are built once by the Manager**; each section owns a
  distinct `targetFile` so parallel builders don't race.
- **Fail loud on misconfig, never silent.** The Workflow normalizes `args`
  whether delivered as an object or a JSON **string** (the harness has handed it
  a stringified payload, which silently emptied the config). It echoes the
  resolved config via `log()` at startup and **aborts** (`error: 'no-sections'` /
  `'bad-args'`) instead of "assembling nothing". The Manager must verify the
  launch (real `projectDir`/`stack`, `sections=N`) before trusting a run. A
  zero-section run is a misfire, not an empty success.
- **No flukes.** The deliverables must come from the *correct process*. If an
  artifact appears despite a broken run, discard it and regenerate it through the
  fixed path — a tuned skill reproduces its results from a clean re-run.

## Workflow-script constraints (easy to trip on)

`workflows/clone-build-loop.js` runs in the Workflow sandbox:
- Plain JS, **not** TypeScript. No type annotations, interfaces, or generics.
- **No filesystem / Node APIs**, and **no `Date.now()` / `Math.random()` /
  argless `new Date()`** (they break resume). Vary labels by index/round; stamp
  timestamps in `state.mjs` (which runs in normal Node), not in the script.
- Top-level `await` and `return` are valid (the harness wraps the body in an
  async context). `meta` must be a pure literal.
- To re-validate syntax after editing:
  `{ echo "async function _(){"; sed 's/^export const meta/const meta/' workflows/clone-build-loop.js; echo "}"; } | node --input-type=module --check -`

## Developing / testing the skill

This skill was built with `skill-creator`. To iterate on quality, use its eval
loop (`evals/evals.json` holds the test cases): run the skill against real target
sites with and without the skill, review outputs in the eval viewer, and refine.
Cloning real sites is token-heavy, so the run itself is resumable — pause and
resume with the `/clone-*` commands if you hit limits mid-eval.

After meaningful edits, also run skill-creator's description optimizer to keep
triggering sharp.

## Provenance

Stands on `clone-website` (extraction + builder dispatch), `ui-pack` (the design
skill bundle), and `agent-browser` (real-browser drive/verify). clone-team adds
the team structure, the enforced Tester gate, the parallel documentation track,
and first-class pause/resume/recovery.
