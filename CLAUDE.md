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
  interaction-motion-analyst.md   # motion-spec author (canonical)
  motion-developer.md             # sequential motion polish pass (canonical)
  tester.md                       # the gate persona (canonical)
  backend-architect.md            # docs persona (canonical)
workflows/
  clone-build-loop.js             # the enforced loop (the engine)
references/
  orchestration.md                # team model + how to launch/steer the Workflow
  state-and-resume.md             # state.json schema, creds pattern, pause/resume/recovery
  extraction-playbook.md          # recon/extraction scripts + spec template
  motion-playbook.md              # motion taxonomy, state-matrix/token templates, drive-to-verify recipe
  backend-doc-template.md         # ARCHITECTURE.md structure
scripts/
  state.mjs                       # durable state CLI (init/status/mark-section/remaining/…)
  capacity.mjs                    # host-capacity probe -> recommended waveSize (check before launch)
  usage-watchdog.mjs              # zero-token 5h-usage-window poller -> WRAP_UP(≥80%)/HARD_STOP(≥90%) sentinels (graceful soft/hard stop + auto-wake)
  install-deps.sh                 # idempotent dep bootstrap: agent-browser CLI + companion skills (run at Preflight)
vendor/
  ui-pack/SKILL.md                # the vendored ui-pack wrapper skill (installer copies it to ~/.claude/skills)
commands/
  clone-status.md / clone-pause.md / clone-resume.md
evals/
  evals.json                      # skill-creator test cases
```

## Conventions & invariants (don't break these)

- **Single source of truth for personas.** The canonical personas are in
  `agents/*.md`. The Workflow embeds tight capsules of the same text but accepts
  `args.personas.{fe,motionAnalyst,motionDev,backend,tester}` overrides — the
  Manager reads the agent files and passes them in, so there's one source. If you
  edit a persona, edit the `agents/*.md` file.
- **Every agent loads `ui-pack` first** and verifies via `agent-browser`. This is
  baked into every persona; keep it there. The two motion agents additionally load
  `ui-animation` (degrading to `references/motion-playbook.md`). **Every agent —
  and the Manager — also loads `karpathy-guidelines`** (behavioral discipline:
  think-before-coding / simplicity / surgical-changes / goal-driven). It's baked
  into each `agents/*.md` first_move, the Workflow capsules (`KARPATHY` const,
  injected into every persona), and the installer's `DEPS` list. Degrades
  gracefully — the four principles apply even uninstalled. Don't make any agent
  hard-depend on it.
- **Dependencies are self-bootstrapping; `ui-pack` is vendored, not external.**
  `ui-pack` is a thin **wrapper** skill (loads `clone-website`, `ui-ux-pro-max`,
  `impeccable`, `emil-design-eng` + points at the `agent-browser` CLI). It is
  **vendored at `vendor/ui-pack/`** so a public install never depends on a second
  repo. `scripts/install-deps.sh` is the idempotent bootstrap: it copies vendored
  `ui-pack` and git-clones the public constituents + `ui-animation`, and installs
  `agent-browser` via npm. **Skills install PROJECT-LOCAL by default** (into
  `$PWD/.claude/skills`) so a clone run never pollutes the user's global
  `~/.claude/skills`; `--global` opts into `~/.claude/skills`, `CLAUDE_SKILLS_DIR`
  overrides both. SKILL.md runs it at Preflight, from the project root. Don't make
  the agents depend on an un-vendored `ui-pack`, don't let the installer overwrite
  an already-present skill (it detects and skips), and don't revert the local
  default to global.
- **Two gates, never one:** Tester (in the loop) then Manager (final). Approved
  work only.
- **The motion track is additive and ordered — don't collapse it.** A dedicated
  Motion Analyst authors the per-page motion spec (`<page>.motion.md`: state
  matrix + animated-element inventory incl. `continuous-decorative` + tokens), and
  a Motion Developer runs a sequential pass **after the FE build, before the gate**
  every round (motion is always the last writer, so it survives FE fix rounds). It
  exists because the layout pass treats motion as binary "does it animate" and
  drops subtle hover/focus + decorative motion. The Motion Developer edits the FE
  dev's file **motion-only** (never relayout/recolor/recontent). Don't fold these
  back into the FE persona or make the analyst optional — that reintroduces the
  exact misses (intro curtains, scroll-scrubbed text, shimmer/particles) it fixes.
- **Resumability rests on disk.** A section is `done` only when Tester-approved
  AND its `targetFile` exists. `state.mjs remaining` reconciles state with disk —
  that reconciliation is what makes cutoffs survivable. Don't add a code path
  that marks `done` without the file existing.
- **Usage cutoffs wind down gracefully, never crash.** `scripts/usage-watchdog.mjs`
  (zero-token poller of the 5h usage window, launched by the Manager at Phase 2)
  writes `WRAP_UP` (≥80%, soft stop) / `HARD_STOP` (≥90%, hard stop) sentinels into
  `.clone-team/`. The wrap-up protocol is injected into **every** agent prompt via
  the Workflow's shared `CONTEXT` (one source — don't duplicate it into the persona
  files; the sentinel path is runtime-derived). On a trip, agents flush a handoff
  and return `wrappedUp: true`; the Workflow's `call()` wrapper then **drains**
  (in-flight sections → `deferred`, assembly skipped, `summary.drained` set). The
  same drain fires when `agent()` returns `null` (terminal API error). The Manager
  auto-wakes a `/clone-resume` at the sentinel's `resets_at`. Don't remove the
  drain, mark a drained section `done`, or let the loop keep launching new agents
  after a wrap-up — that reintroduces the mid-thought death this prevents.
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

## Releasing — bump the version (multiple points, never miss one)

This skill is published as a Claude Code **plugin**. Claude Code caches each
install by version and **only offers an update when the `version` string changes**
— pushing new commits to `main` *without* a version bump ships **nothing** to
existing users. So a release is not "merge to main"; it's "bump the version,
then merge to main." The version lives in **three** machine-read spots that must
stay identical, plus the human-facing changelog:

1. `.claude-plugin/plugin.json` → `"version"` — **the one the plugin system reads
   for update detection.** If only one gets bumped, it must be this. Bump all
   three anyway.
2. `.claude-plugin/marketplace.json` → the plugin entry's `"version"` (the
   `plugins[]` item).
3. `.claude-plugin/marketplace.json` → the marketplace `metadata.version`.
4. `CHANGELOG.md` → add a new `## [x.y.z]` section + the dated link at the bottom.
   (Not read by the plugin system, but it's the release story and the
   `/clone-update` changelog link.)

The Preflight **update nudge** in `SKILL.md` and the `/clone-update` command both
compare against `plugin.json`'s `version` on `main` — so bumping it is also what
makes those two surface the update. One rule covers everything: **bump the
version.** A GitHub Release/tag is *not* required and does *not* trigger updates
— the `version` field on the default branch is the trigger; the merge is the
publish. Verify the three JSON spots match after editing
(`grep -rn '"version"' .claude-plugin/`).

## Provenance

Stands on `clone-website` (extraction + builder dispatch), `ui-pack` (the design
skill bundle), and `agent-browser` (real-browser drive/verify). clone-team adds
the team structure, the enforced Tester gate, the parallel documentation track,
and first-class pause/resume/recovery.
