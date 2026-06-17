# Changelog

All notable changes to **clone-team** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions are tracked
in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`; plugin
installs update automatically when these bump.

## [1.4.1]

### Fixed
- **Usage watchdog now works on macOS (and stays OS-agnostic).** The watchdog
  authenticates to the usage endpoint with Claude Code's login token, but that
  token lives in a different place per OS. On macOS the live token is in the login
  **Keychain** (`Claude Code-credentials`); the on-disk
  `~/.claude/.credentials.json` is a frequently-stale copy whose token expires
  while the Keychain stays current — so the watchdog was reading the wrong vault
  and getting `HTTP 401`, silently disabling the proactive soft/hard-stop on every
  Mac. `readToken()` now reads the Keychain first on macOS (via `security
  find-generic-password`; the token is never written to disk), and falls back to
  the on-disk file on Linux/Windows or if the Keychain entry is missing. One code
  path, no per-client setup, no separate installer — the watchdog just works
  everywhere. The durability layer (per-section disk checkpoint) was never
  affected; this restores the *proactive* wind-down that was effectively
  Mac-broken.

## [1.4.0]

### Added
- **Usage-window watchdog — graceful soft/hard stop + auto-wake on reset.** A new
  zero-token poller, `scripts/usage-watchdog.mjs`, watches the account's 5-hour
  usage window (the same endpoint `/usage` reads) and drops sentinel files in
  `.clone-team/` as it nears the cap: `WRAP_UP` at **≥80%** (soft stop — agents
  finish the current atomic step, write a handoff, return) and `HARD_STOP` at
  **≥90%** (hard stop — stop immediately, flush the handoff as-is). The Manager
  launches it as a background process at Phase 2; agents check the sentinels
  between steps via a wrap-up protocol injected into every agent prompt. The
  build Workflow then **drains** — in-flight sections return `deferred`, assembly
  is skipped, and the return carries `summary.drained` + `summary.deferred` — so a
  usage cutoff becomes a clean wind-down instead of agents dying mid-task. The
  sentinels record `resets_at`, and the Manager **auto-schedules a `/clone-resume`**
  for just after the window resets; deferred sections pick up from their
  `*.handoff.md` files. The same drain fires when an agent dies on a terminal API
  error, so an outage stops burning tokens too. Mirrors the mechanism proven in
  the sibling `game-build-team` skill.

### Changed
- `scripts/state.mjs reconcile` now clears stale `WRAP_UP`/`HARD_STOP` sentinels
  so a relaunched loop isn't immediately re-tripped before the watchdog's next
  poll. `/clone-resume` restarts the watchdog (a resume is a fresh Workflow);
  `/clone-status` surfaces an active cutoff and its reset time.

## [1.3.0]

### Added
- **`karpathy-guidelines` behavioral skill, loaded by every agent and the
  Manager** — a single-file discipline (think before coding, simplicity first,
  surgical changes, goal-driven execution) derived from Andrej Karpathy's notes
  on LLM coding pitfalls. Wired into all five agent personas, the build-loop
  Workflow capsules, and the dependency installer. Degrades gracefully — the
  four principles apply even when the skill isn't installed.
- **Preflight update-availability nudge** — on the first run in a project the
  Manager compares the installed version against the latest on `main` and prints
  a one-line `/clone-update` hint if behind. Fail-soft and once-per-project; never
  blocks, prompts, or auto-updates.

### Changed
- `CLAUDE.md` documents the release version-bump checklist (the three machine-read
  version spots + changelog) so a release never silently ships nothing.

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

[1.4.1]: https://github.com/Varalix-Digitech-Solutions/clone-team/releases/tag/v1.4.1
[1.4.0]: https://github.com/Varalix-Digitech-Solutions/clone-team/releases/tag/v1.4.0
[1.3.0]: https://github.com/Varalix-Digitech-Solutions/clone-team/releases/tag/v1.3.0
[1.2.0]: https://github.com/Varalix-Digitech-Solutions/clone-team/releases/tag/v1.2.0
[1.1.0]: https://github.com/Varalix-Digitech-Solutions/clone-team/releases/tag/v1.1.0
[1.0.0]: https://github.com/Varalix-Digitech-Solutions/clone-team/releases/tag/v1.0.0
[#12]: https://github.com/Varalix-Digitech-Solutions/clone-team/pull/12
