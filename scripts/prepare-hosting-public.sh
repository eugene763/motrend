#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-}"

if [[ "$MODE" != "dev" ]]; then
  echo "Usage: scripts/prepare-hosting-public.sh dev" >&2
  exit 1
fi

TARGET_DIR="$ROOT_DIR/.firebase-hosting/motrend-dev-public"

rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
cp -R "$ROOT_DIR/public/." "$TARGET_DIR/"

cat >"$TARGET_DIR/robots.txt" <<'EOF'
User-agent: *
Disallow: /
EOF

echo "Prepared MoTrend dev Hosting public dir: $TARGET_DIR"
