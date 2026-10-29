#!/bin/sh
# Drop root to PUID:PGID (LinuxServer.io convention) so files created or renamed on the
# /media, /import and /trash shares keep the right owner. Only /app is chown'ed; the
# media shares are never touched recursively.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
APP_DIR="${APP_DIR:-/app}"

if [ "$(id -u)" = "0" ]; then
  if ! getent group "$PGID" >/dev/null 2>&1; then
    addgroup -g "$PGID" organizer
  fi
  GROUP="$(getent group "$PGID" | cut -d: -f1)"
  if ! getent passwd "$PUID" >/dev/null 2>&1; then
    adduser -D -H -u "$PUID" -G "$GROUP" -s /sbin/nologin organizer
  fi
  mkdir -p "$APP_DIR"
  chown -R "$PUID:$PGID" "$APP_DIR"
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
