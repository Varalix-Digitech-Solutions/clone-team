#!/usr/bin/env bash
# install-deps.sh — install clone-team's companion skills + the agent-browser CLI.
#
# IDEMPOTENT BY DESIGN: anything already installed is detected and SKIPPED, never
# re-downloaded or overwritten. Safe to run repeatedly.
#
# Usage:
#   bash install-deps.sh            # install whatever is missing (PROJECT-LOCAL)
#   bash install-deps.sh --check    # dry run: report what's missing, install nothing
#   bash install-deps.sh --global   # install into the user's global ~/.claude/skills
#
# By DEFAULT skills install PROJECT-LOCAL, into ./.claude/skills of the current
# directory — so cloning a site does NOT pollute the user's global skills. Pass
# --global for ~/.claude/skills, or set CLAUDE_SKILLS_DIR to target an explicit
# path (overrides both). The agent-browser CLI is a global npm tool regardless.
# Requires: git, and npm (only if agent-browser is missing).

set -uo pipefail

CHECK=0; GLOBAL=0
for a in "$@"; do
  case "$a" in
    --check)  CHECK=1 ;;
    --global) GLOBAL=1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR_DIR="$SCRIPT_DIR/../vendor"

# Resolve the skills dir: explicit override > --global > project-local (default).
if [ -n "${CLAUDE_SKILLS_DIR:-}" ]; then
  SKILLS_DIR="$CLAUDE_SKILLS_DIR"
elif [ "$GLOBAL" = "1" ]; then
  SKILLS_DIR="$HOME/.claude/skills"
else
  SKILLS_DIR="$PWD/.claude/skills"   # PROJECT-LOCAL by default
fi
mkdir -p "$SKILLS_DIR"

installed=(); skipped=(); missing=(); failed=()

have_skill() { [ -e "$SKILLS_DIR/$1/SKILL.md" ]; }

# --- 1) agent-browser CLI (npm) --------------------------------------------
if command -v agent-browser >/dev/null 2>&1; then
  skipped+=("agent-browser (CLI already present)")
elif [ "$CHECK" = "1" ]; then
  missing+=("agent-browser (npm i -g agent-browser)")
elif command -v npm >/dev/null 2>&1; then
  echo "Installing agent-browser CLI via npm..."
  if npm i -g agent-browser >/dev/null 2>&1; then installed+=("agent-browser"); else failed+=("agent-browser — try: npm i -g agent-browser"); fi
else
  failed+=("agent-browser — npm not found; install Node/npm then: npm i -g agent-browser")
fi

# --- 2) ui-pack wrapper (vendored with this skill) -------------------------
# ui-pack is the design/frontend bundle the agents load. It ships inside this
# repo (../vendor/ui-pack) so it's always available without a second repo.
if have_skill ui-pack; then
  skipped+=("ui-pack (already present)")
elif [ "$CHECK" = "1" ]; then
  missing+=("ui-pack  <- vendored (../vendor/ui-pack)")
elif [ -f "$VENDOR_DIR/ui-pack/SKILL.md" ]; then
  if cp -r "$VENDOR_DIR/ui-pack" "$SKILLS_DIR/ui-pack"; then installed+=("ui-pack"); else failed+=("ui-pack (copy failed)"); fi
else
  failed+=("ui-pack (vendored copy not found at $VENDOR_DIR/ui-pack)")
fi

# --- 3) companion skills (git) ---------------------------------------------
# entry: "repo|branch|srcdir|names"   names = comma-list, or '*' for every skill in srcdir
DEPS=(
  "JCodesMore/ai-website-cloner-template|master|.claude/skills|clone-website"
  "pbakaus/impeccable|main|.claude/skills|impeccable"
  "emilkowalski/skill|main|skills|emil-design-eng"
  "mblode/agent-skills|main|skills|ui-animation"
  "nextlevelbuilder/ui-ux-pro-max-skill|main|.claude/skills|*"
)

for entry in "${DEPS[@]}"; do
  IFS='|' read -r repo branch srcdir names <<<"$entry"

  # For explicit names we can decide BEFORE cloning whether anything is missing.
  need_clone=0
  if [ "$names" = "*" ]; then
    need_clone=1   # unknown set — decide after clone
  else
    IFS=',' read -ra want <<<"$names"
    for n in "${want[@]}"; do have_skill "$n" || need_clone=1; done
  fi
  if [ "$need_clone" = "0" ]; then
    skipped+=("$names (already present)")
    continue
  fi

  if [ "$CHECK" = "1" ]; then
    missing+=("$names  <- github.com/$repo")
    continue
  fi

  tmp=$(mktemp -d)
  echo "Fetching $repo ..."
  if ! git clone --depth 1 --branch "$branch" "https://github.com/$repo.git" "$tmp" >/dev/null 2>&1; then
    failed+=("$repo (git clone failed)"); rm -rf "$tmp"; continue
  fi

  if [ "$names" = "*" ]; then
    for d in "$tmp/$srcdir"/*/; do
      [ -f "${d}SKILL.md" ] || continue
      n=$(basename "$d")
      if have_skill "$n"; then skipped+=("$n (already present)"); else cp -r "$d" "$SKILLS_DIR/$n" && installed+=("$n"); fi
    done
  else
    IFS=',' read -ra want <<<"$names"
    for n in "${want[@]}"; do
      if have_skill "$n"; then skipped+=("$n (already present)"); continue; fi
      if [ -f "$tmp/$srcdir/$n/SKILL.md" ]; then cp -r "$tmp/$srcdir/$n" "$SKILLS_DIR/$n" && installed+=("$n"); else failed+=("$n (SKILL.md not found in $repo/$srcdir)"); fi
    done
  fi
  rm -rf "$tmp"
done

# --- report ----------------------------------------------------------------
echo
echo "── clone-team dependency setup (${SKILLS_DIR}) ──"
if [ "$CHECK" = "1" ]; then
  printf '  ⏭  already present : %s\n' "${skipped[*]:-none}"
  printf '  ⬇  would install   : %s\n' "${missing[*]:-none}"
  echo "  (dry run — nothing was changed; re-run without --check to install)"
else
  printf '  ✅ installed       : %s\n' "${installed[*]:-none}"
  printf '  ⏭  already present : %s\n' "${skipped[*]:-none}"
  [ ${#failed[@]} -gt 0 ] && printf '  ⚠️  needs attention : %s\n' "${failed[*]}"
fi
exit 0
