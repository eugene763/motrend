#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

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