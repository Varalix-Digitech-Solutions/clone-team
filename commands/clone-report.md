---
name: clone-report
description: Render and open the clone-team results report for the current clone project — per-section verdicts, round-by-round trend, numeric visual fidelity (pixel-diff % + SSIM), and the final scorecard.
argument-hint: "[projectDir]"
allowed-tools:
  - Bash
  - Read
---
Render and surface the results-analysis report for a clone-team run.

1. Resolve the project dir: use `$ARGUMENTS` if given, else the current working
   directory. The results live in `<projectDir>/.clone-team/report.json`.
2. If `report.json` does not exist, say so. It is written by the Tester (one
   `append-round` per round) and finalized by the Manager — so it appears once a
   run has produced at least one tested section. Offer `/clone-status` for
   lifecycle state instead.
3. Render the HTML from the JSON source of truth:
   `node <clone-team-skill>/scripts/report.mjs render --dir <projectDir>`
   (the skill usually lives at `~/.claude/skills/clone-team`). This writes
   `<projectDir>/.clone-team/report.html`.
4. Open `report.html` for the user (e.g. `cmd.exe /c start "" "<path>"` on
   Windows, `open` on macOS, `xdg-open` on Linux). Print the absolute path too.
5. For a quick text summary, also run
   `node <clone-team-skill>/scripts/report.mjs json --dir <projectDir>` and
   report in a few lines: final verdict, sections passed / flagged, the
   lowest-scoring section, and any outstanding blocker/major issues.
