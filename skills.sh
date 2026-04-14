#!/usr/bin/env bash
# Install Claude Code skills bundled in this repo.
#
# Usage:
#   ./skills.sh                 # install all skills in ./skills/
#   ./skills.sh <name> [<name>] # install only the named skills
#
# Destination:
#   $CLAUDE_SKILLS_DIR (if set), otherwise $HOME/.claude/skills

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src_dir="$repo_dir/skills"
dest_dir="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

if [[ ! -d "$src_dir" ]]; then
  echo "error: no skills directory at $src_dir" >&2
  exit 1
fi

mkdir -p "$dest_dir"

install_one() {
  local name="$1"
  local from="$src_dir/$name"
  local to="$dest_dir/$name"

  if [[ ! -d "$from" ]]; then
    echo "error: skill '$name' not found in $src_dir" >&2
    return 1
  fi
  if [[ ! -f "$from/SKILL.md" ]]; then
    echo "error: skill '$name' is missing SKILL.md" >&2
    return 1
  fi

  rm -rf "$to"
  cp -R "$from" "$to"
  echo "installed: $name -> $to"
}

if [[ $# -gt 0 ]]; then
  for name in "$@"; do
    install_one "$name"
  done
else
  shopt -s nullglob
  for skill in "$src_dir"/*/; do
    install_one "$(basename "$skill")"
  done
fi

echo "done. restart Claude Code (or start a new session) to load the skills."
