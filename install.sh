#!/usr/bin/env bash
set -euo pipefail

repo_url="https://github.com/rylena/openclaw-instagram.git"
base_dir="${OPENCLAW_INSTAGRAM_BASE_DIR:-$HOME/.openclaw/plugins-src}"
repo_dir="${OPENCLAW_INSTAGRAM_REPO_DIR:-$base_dir/openclaw-instagram}"

mkdir -p "$base_dir"

if [ -d "$repo_dir/.git" ]; then
  git -C "$repo_dir" pull --ff-only
else
  git clone "$repo_url" "$repo_dir"
fi

exec node "$repo_dir/scripts/setup-local.mjs" "$@"
