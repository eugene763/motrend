#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ID="${PROJECT_ID:-gen-lang-client-0651837818}"
SITE_ID="${SITE_ID:-moads-trend-dev}"

resolve_node22_bin() {
  if command -v brew >/dev/null 2>&1; then
    local brew_prefix
    brew_prefix="$(brew --prefix node@22 2>/dev/null || true)"
    if [[ -n "$brew_prefix" && -x "$brew_prefix/bin/node" ]]; then
      echo "$brew_prefix/bin"
      return 0
    fi
  fi

  for candidate in \
    "/opt/homebrew/opt/node@22/bin" \
    "/usr/local/opt/node@22/bin"
  do
    if [[ -x "$candidate/node" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

NODE22_BIN="$(resolve_node22_bin || true)"
if [[ -n "$NODE22_BIN" ]]; then
  export PATH="$NODE22_BIN:$PATH"
fi

echo "==> Using Node $(node -v)"

echo "==> Checking git status"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty. Commit or stash changes before deploying." >&2
  git status --porcelain >&2
  exit 1
fi

"$ROOT_DIR/scripts/prepare-hosting-public.sh" dev

echo "==> Deploying MoTrend dev Hosting only: $SITE_ID"
firebase deploy \
  --project "$PROJECT_ID" \
  --config "$ROOT_DIR/firebase.hosting.dev.json" \
  --only "hosting:$SITE_ID"
