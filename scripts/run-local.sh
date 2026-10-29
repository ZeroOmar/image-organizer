#!/usr/bin/env bash
# Run Image Organizer locally without Docker, sandboxed in .local-test/ (ignored by git and docker):
#
#   .local-test/app/              stands in for /app    (config.yaml, data/app.db, cache/thumbs)
#   .local-test/media/            stands in for /media  (seeded from fixtures/media)
#   .local-test/import/           stands in for /import (seeded from fixtures/import)
#   .local-test/trash/            stands in for /trash
#   .local-test/app-config.yaml   the APP_CONFIG used for local runs (edit freely)
#
# Usage: scripts/run-local.sh [--reset] [--prod]
#   --reset  wipe .local-test/ and re-seed it from fixtures/
#   --prod   build everything and serve the built web app from the server (like the container)
# Login: admin / admin
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="$ROOT/.local-test"
PORT="${PORT:-8080}"
RESET=0
PROD=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --prod) PROD=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

# --- prerequisites -----------------------------------------------------------
missing=0
need() { # need <cmd> <brew formula>
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "✗ $1 not found — install with: brew install $2" >&2
    missing=1
  fi
}
need node node@22
need exiftool exiftool
need ffmpeg ffmpeg
[ "$missing" = 0 ] || exit 1
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "✗ Node $NODE_MAJOR found; Node 22+ is required (brew install node@22)" >&2
  exit 1
fi

# --- sandbox -----------------------------------------------------------------
if [ "$RESET" = 1 ]; then
  echo "Resetting $SANDBOX"
  rm -rf "$SANDBOX"
fi

cd "$ROOT"
[ -d node_modules ] || npm install

if [ ! -d "$SANDBOX" ]; then
  echo "Creating $SANDBOX"
  mkdir -p "$SANDBOX/app" "$SANDBOX/trash"
  cp -Rp "$ROOT/fixtures/media" "$SANDBOX/media"
  cp -Rp "$ROOT/fixtures/import" "$SANDBOX/import"
fi

if [ ! -f "$SANDBOX/app-config.yaml" ]; then
  HASH="$(node -e 'console.log(require("bcryptjs").hashSync("admin", 10))' 2>/dev/null ||
    (cd apps/server && node -e 'console.log(require("bcryptjs").hashSync("admin", 10))'))"
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')"
  cat >"$SANDBOX/app-config.yaml" <<EOF
# Local APP_CONFIG for scripts/run-local.sh. Login: admin / admin
admin:
  username: admin
  passwordHash: "$HASH"
session:
  secret: "$SECRET"
  ttlHours: 168
server:
  host: 127.0.0.1
  port: $PORT
media:
  root: "$SANDBOX/media"
import:
  root: "$SANDBOX/import"
  maxUploadMB: 2048
trash:
  root: "$SANDBOX/trash"
  retentionDays: 30
timezone:
  default: Africa/Cairo
EOF
fi

export APP_DIR="$SANDBOX/app"
export APP_CONFIG="$(cat "$SANDBOX/app-config.yaml")"
export PORT
export API_PORT="$PORT"

if [ "$PROD" = 1 ]; then
  npm run build
  echo
  echo "▶ Image Organizer: http://127.0.0.1:$PORT  (admin / admin)"
  exec node apps/server/dist/main.js
else
  echo
  echo "▶ Image Organizer (dev): http://localhost:5173  (admin / admin) — API on :$PORT"
  exec npm run dev
fi
