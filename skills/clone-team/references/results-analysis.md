# Results analysis — the consistent way clone-team reports a run

This is the canonical reference for **how a clone run's outcome is measured,
recorded, and reported**. Before this layer, the engine produced rich structured
verdicts that lived only in the Workflow's in-memory return and vanished when the
session ended. Now every run leaves a durable, machine-readable record plus a
human report — built from the same five StructuredOutput schemas the engine
already enforces.

Two files do the work, and they deliberately read like one toolkit with
`state.mjs`:

| Script | Owns | Analogy |
|---|---|---|
| `scripts/state.mjs` | **Lifecycle** — phase, which sections are done/built/pending/flagged, resume reconciliation | "where are we" |
| `scripts/report.mjs` | **Outcome** — per-section, per-round verdicts + issue counts + metrics + final scorecard | "how did it turn out" |
| `scripts/visual-diff.mjs` | **Numbers** — pixel-diff ratio + SSIM for one screenshot pair | the measuring tape |

The Workflow runtime **cannot write files** (no `fs`, no clock). So persistence
always goes through a Node CLI invoked by an agent or the Manager — the same
reason the Tester already calls `state.mjs mark-section`.

## The record: `.clone-team/report.json`

One file per clone project, the source of truth. `report.html` is *rendered from
it* and is disposable (JSON-then-render convention).

```jsonc
{
  "version": 1,
  "runId": "wf_…",                 // the Workflow run id
  "goal": "…", "targetUrl": ["…"], "stack": "…",
  "startedAt": "ISO", "completedAt": "ISO|null",
  "finalVerdict": "OK | NG | not-run",
  "summary": { "sections": 9, "passed": 8, "flagged": ["Pricing"], "backendCoverage": "substantial" },
  "sections": [
    {
      "name": "Hero",
      "status": "pass | flagged | building",
      "finalScore": 0.97,          // mean SSIM of the last round's viewports (null if no metrics)
      "rounds": [
        { "round": 1, "verdict": "NG", "at": "ISO",
          "issueCounts": { "blocker": 1, "major": 2, "minor": 0 },
          "metrics": { "1440": { "diffPixelRatio": 0.031, "ssim": 0.94 },
                       "768":  { "diffPixelRatio": 0.020, "ssim": 0.95 },
                       "390":  { "diffPixelRatio": 0.050, "ssim": 0.90 } },
          "issues": [ /* VERDICT_SCHEMA.issues, verbatim */ ] },
        { "round": 2, "verdict": "OK", "at": "ISO",
          "issueCounts": { "blocker": 0, "major": 0, "minor": 0 },
          "metrics": { "1440": { "diffPixelRatio": 0.0, "ssim": 1.0 }, "768": { … }, "390": { … } },
          "issues": [] }
      ]
    }
  ],
  "backend": { "coverage": "substantial", "gaps": [ … ], "docPath": "…" },
  "artifacts": { "html": ".clone-team/report.html" }
}
```

The final full-page regression is recorded as a pseudo-section named **`Full
Page`**, so the page-level trend sits alongside the section-level ones.

## The metrics: `visual-diff.mjs`

```
node scripts/visual-diff.mjs --original <a.png> --clone <b.png> [--diff-out <diff.png>]
→ { "width":1440, "height":900, "diffPixels":1234, "diffPixelRatio":0.0009, "ssim":0.987 }
```

- **`diffPixelRatio`** — `pixelmatch` (YIQ per-pixel, the algorithm Playwright's
  `toHaveScreenshot` uses). Convention: **≤ 0.01** (≤1% of pixels differ) ≈ a
  faithful match.
- **`ssim`** — structural similarity (`ssim.js`, the `mssim` scalar). Range 0–1;
  **≥ 0.98** ≈ visually identical. Catches structural drift that raw pixel
  counts miss, and is less twitchy about anti-aliasing.
- **Size mismatch is non-fatal.** If the two screenshots differ in dimensions
  the tool returns `diffPixelRatio: null, ssim: null` and a `note`, exit code 0 —
  it annotates the gate, it never crashes it.

Both deps (`pixelmatch`, `pngjs`, `ssim.js`) are pure-JS — no native build, no
Python. They install locally into `scripts/` via `install-deps.sh` (idempotent).

**Metrics annotate, they never gate.** The Tester's eye is still the gate: `OK`
means "exact copy, zero issues". The numbers give you a trend and a tunable
signal; they do not auto-pass or auto-fail a section.

## How it wires together

```
Manager (Phase 2 launch):
  report.mjs init --dir … --run-id … --goal … --target … --stack …
  Workflow(... args: { statePath, reportPath, visualDiffPath, … })

Tester (every round, OK and NG — inside the loop):
  screenshot original + clone @ 1440/768/390
  visual-diff.mjs (×3)                          → metrics
  report.mjs append-round --section … --round … --verdict … --issues-json … --metrics-json …
  report.mjs … (on OK also: state.mjs mark-section --status done)   // lifecycle

Manager (Phase 3 completion):
  report.mjs finalize --final-verdict … --summary-json '<Workflow return summary>'
  report.mjs render                              → .clone-team/report.html  (auto-open)
  state.mjs set --key finalVerdict --value …
```

Everything is gated on the paths being passed: if `reportPath` is absent the
agents skip the record silently and the run still works — it just won't leave a
scorecard.

## Reading it

- **`/clone-report [projectDir]`** — renders + opens `report.html` and prints a
  text summary.
- **`/clone-status [projectDir]`** — lifecycle view; add `--json` (via
  `state.mjs status --dir … --json`) for a machine-readable dump.
- **`report.mjs json --dir …`** — the raw results record for any downstream tool.

## Verdict vocabulary (canonical)

Same fact, historically different words depending on where you read it. The
canonical mapping:

| Token | Where | Means |
|---|---|---|
| `OK` / `NG` | Tester verdict, `VERDICT_SCHEMA`, report rounds | section/page is / isn't an exact copy this round |
| `pass` | Workflow `sectionResults[].status`, report `section.status` | section cleared the gate (≡ state's `done`) |
| `done` | `state.json` section status | gate-cleared **and** file on disk (lifecycle) |
| `flagged` | both | hit the round cap; needs Manager attention |
| `not-run` | `finalVerdict` | assembly was skipped / run never finalized |

`pass` (outcome) and `done` (lifecycle) are the same event seen from two files.

## Design rationale (SOTA)

The shape is not invented — it is the convergence of the field:

- **Metrics:** pixelmatch + SSIM are the standard JS visual-regression pair
  (Playwright, jest-image-snapshot). LPIPS/CLIP are more perceptual but
  Python-only, so they're out for a JS skill (a future Comprehensive tier could
  add them via a sidecar).
- **JSON-then-render** with an immutable per-run record + rendered HTML is the
  CTRF / Allure / promptfoo pattern.
- **Per-section `scores` + per-round breakdown + issue lists** mirror Braintrust
  `scores{}`, promptfoo `componentResults`, and AISI Inspect `SampleScore`.
- The **dimensions worth scoring for a clone** (visual / layout / text / color /
  interaction) are the consensus of Design2Code (NAACL'25), WebVR ('26),
  FullFront ('25), and WebGen-V ('25).

## Upgrade path (out of scope here)

The **Comprehensive** tier would add: an LLM-judge 5-dimension scorecard baked
into the gate (visual/layout/text/color/interaction, each 0–1, with rationale),
cross-run history under `runs/run-N.json` for a score-over-time trend, a CTRF
export for CI test-result tabs, and a README score badge. The current schema
leaves room: `section.finalScore` and the per-round `metrics` object are the
hooks those would extend.
