#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "==> Git status"
git status --porcelain

echo "==> Switching Firebase to prod"
firebase use prod

echo "==> Deploying (functions + hosting + rules/indexes)"
firebase deploy
