---
name: clone-update
description: Check whether the installed clone-team skill is up to date and update it the right way for how it's installed — defers to the plugin manager for plugin installs, guides a safe re-copy for manual installs. Never touches in-flight clone state or credentials.
argument-hint: ""
allowed-tools:
  - Bash
  - Read
---
Check the installed clone-team version against the latest release and update it
**the correct way for how it was installed**. This is a version-aware advisor,
not a blind `git pull` — overwriting a plugin-managed directory or a user's local
copy is a footgun, so detect the install type first and route accordingly.

Run-state and credentials are **never** at risk here: a run's `.clone-team/`
state and `creds.local.json` live in the *cloned project's* directory, not in the
skill install dir. Updating the skill does not go near them. Still, never copy
over or delete anything under a `.clone-team/` path.

### 1. Find the latest version
Read the canonical version from the default branch on GitHub (no clone needed):

```
gh api repos/Varalix-Digitech-Solutions/clone-team/contents/.claude-plugin/plugin.json \
  --jq '.content' 2>/dev/null | base64 -d | grep -m1 '"version"'
```

If `gh` is unavailable, fetch the same file over HTTPS:
`https://raw.githubusercontent.com/Varalix-Digitech-Solutions/clone-team/main/.claude-plugin/plugin.json`.
Call this `LATEST`.

### 2. Locate the local install and read its version
clone-team is installed in one of two shapes:
- **Plugin** — under the Claude Code plugins dir (e.g.
  `~/.claude/plugins/**/clone-team/`, alongside a `.claude-plugin/plugin.json`).
- **Manual** — the skill copied to `~/.claude/skills/clone-team/` (often *without*
  the repo root, so `.claude-plugin/plugin.json` may be absent).

Find it, then read its `version` from the nearest `.claude-plugin/plugin.json` if
present. If no manifest is present (a bare manual copy), say the local version is
**unknown** rather than guessing. Call this `LOCAL`.

### 3. Report status
Always tell the user plainly: `LOCAL` vs `LATEST`, and whether they're up to date,
behind, or unknown. Link the changelog:
`https://github.com/Varalix-Digitech-Solutions/clone-team/blob/main/CHANGELOG.md`.
If `LOCAL == LATEST`, stop here — nothing to do.

### 4. Route the update by install type

**Plugin install → defer to the plugin manager. Do NOT mutate files.**
Tell the user their install auto-updates through Claude Code's plugin system and
to update via the `/plugin` interface (manage the `clone-team` marketplace/plugin
there). A manual file copy into a plugin-managed directory will be reverted by the
manager and can corrupt its state — so don't do it.

**Manual install → offer a guided, safe re-copy.** Confirm with the user first,
then:
1. Clone the latest into a temp dir:
   `git clone --depth 1 https://github.com/Varalix-Digitech-Solutions/clone-team.git <tmp>`
2. Copy the skill over the existing install:
   `cp -r <tmp>/skills/clone-team/. ~/.claude/skills/clone-team/`
   (and refresh the commands if the user installed them:
   `cp <tmp>/commands/clone-*.md ~/.claude/commands/`).
   **Never** copy into, or remove, anything under a `.clone-team/` directory.
3. Re-run the idempotent dependency bootstrap so any new deps land:
   `bash ~/.claude/skills/clone-team/scripts/install-deps.sh`
4. Tell the user to restart Claude Code if the commands don't refresh.

### 5. Confirm
Re-read the local version and confirm it now matches `LATEST`, or report exactly
what changed and any manual step still needed.
