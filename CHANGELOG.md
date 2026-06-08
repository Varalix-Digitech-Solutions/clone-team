# Changelog

All notable changes to **clone-team** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions are tracked
in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`; plugin
installs update automatically when these bump.

## [1.2.0]

### Added
- **`/clone-update` command** — checks the installed skill version against the
  latest release and updates it the right way for how it's installed: defers to
  the plugin manager for plugin installs, guides a safe re-copy for manual
  installs. Never touches in-flight clone state or credentials.
- `CHANGELOG.md` (this file).

### Changed
- README install section now lists the full `/clone-*` command family, including
  `/clone-report` and `/clone-update`.

## [1.1.0]

### Added
- **Consistent results-analysis layer** — runs now persist their outcome, not
  just their lifecycle. Thanks to **[@Lcxiv](https://github.com/Lcxiv) (Louis
  Condevaux)** for this — the project's first external contribution. ([#12])
  - `scripts/report.mjs` — durable `.clone-team/report.json` results record
    (`init` / `append-round` / `finalize` / `json` / `render`) plus a
    self-contained `report.html` scorecard.
  - `scripts/visual-diff.mjs` — pure-JS numeric visual fidelity per screenshot
    pair (pixelmatch diff ratio + ssim.js SSIM), size-mismatch safe.
  - Engine wiring: the Tester records every round (OK *and* NG) with per-viewport
    metrics; `VERDICT_SCHEMA` gains optional `roundNumber` + `metrics`
    (backward-compatible).
  - `state.mjs` gains `finalVerdict` / `completedAt` / `reportPath` fields and a
    `status --json` machine-readable mode.
  - `/clone-report` command to render and open the scorecard anytime.
  - `references/results-analysis.md` — schema, metric thresholds, verdict
    vocabulary, wiring, and upgrade path.

### Notes
- The pass/fail meaning of the Tester gate is unchanged — metrics annotate the
  Tester's judgment, they never override it.

## [1.0.0]

### Added
- Initial public release: the **clone-team** skill — a Manager, Frontend
  Developer, Backend Architect, and Tester that iteratively clone any website
  into a pixel-perfect UI **and** produce reverse-engineered architecture docs,
  driven by a deterministic background Workflow with an unskippable test gate and
  first-class pause/resume/recovery.

[1.2.0]: https://github.com/Varalix-Digitech-Solutions/clone-team/releases/tag/v1.2.0
[1.1.0]: https://github.com/Varalix-Digitech-Solutions/clone-team/releases/tag/v1.1.0
[1.0.0]: https://github.com/Varalix-Digitech-Solutions/clone-team/releases/tag/v1.0.0
[#12]: https://github.com/Varalix-Digitech-Solutions/clone-team/pull/12
