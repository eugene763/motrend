#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

resolve_node22_bin() {
  if command -v brew >/dev/null 2>&1; then
    local brew_prefix
    brew_prefix="$(brew --prefix node@22 2>/dev/null || true)"
    if [ -n "$brew_prefix" ] && [ -x "$brew_prefix/bin/node" ]; then
      echo "$brew_prefix/bin"
      return 0
    fi
  fi

  for candidate in \
    "/opt/homebrew/opt/node@22/bin" \
    "/usr/local/opt/node@22/bin"
  do
    if [ -x "$candidate/node" ]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

NODE22_BIN="$(resolve_node22_bin || true)"
if [ -n "$NODE22_BIN" ]; then
  export PATH="$NODE22_BIN:$PATH"
fi

echo "==> Using Node $(node -v)"

echo "==> Checking git status"
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working tree is dirty. Commit or stash changes before deploying."
  git status --porcelain
  exit 1
fi

echo "==> Switching Firebase to prod"
firebase use prod

echo "==> Deploying (functions + hosting + rules/indexes)"
firebase deploy
