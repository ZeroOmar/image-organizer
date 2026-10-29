---
name: run-and-verify
description: Run Image Organizer locally without Docker (scripts/run-local.sh, sandbox in .local-test/) and verify a change end to end via the API, ExifTool and headless-browser screenshots.
---

# Run and verify locally

This machine has no Docker. Everything runs natively in the git- and docker-ignored `.local-test/` sandbox.

## Prerequisites

`brew install node@22 exiftool ffmpeg`. The script checks for them and prints hints.

## Start

```bash
scripts/run-local.sh --reset --prod   # clean fixtures, build, serve http://127.0.0.1:8080
scripts/run-local.sh                  # dev: Vite http://localhost:5173 + API :8080 (hot reload)
```

Run it in the background, then wait for the port:

```bash
until curl -sf http://127.0.0.1:8080/api/health >/dev/null; do sleep 1; done
```

Stop: `lsof -ti:8080 -sTCP:LISTEN | xargs kill` (and `:5173` in dev).

Login: **admin / admin** (`.local-test/app-config.yaml`). Sandbox roots: `.local-test/{media,import,trash}`, app dir `.local-test/app`.

## API smoke test

```bash
C=/tmp/io-cookie
curl -s -c $C -H 'x-requested-with: image-organizer' -H 'content-type: application/json' \
  -d '{"username":"admin","password":"admin"}' http://127.0.0.1:8080/api/auth/login
curl -s -b $C 'http://127.0.0.1:8080/api/folder?root=media&rel=Trips/Bikers' | head -c 400
curl -s -b $C -H 'x-requested-with: image-organizer' -H 'content-type: application/json' \
  -d '{"selection":{"folder":{"root":"media","rel":"Trips/Bikers"}},"steps":[{"type":"rename"}]}' \
  http://127.0.0.1:8080/api/jobs/plan
exiftool -j -n -DateTimeOriginal -OffsetTimeOriginal -GPSLatitude .local-test/media/Trips/Bikers/*.jpg
```

## Screenshots (headless Chromium)

Install Playwright once in a scratch directory (not in the repo): `npm i playwright@1 && npx playwright install chromium`. Then drive the app:

- `page.goto('/')` → fill `#u`/`#p` → click `button[type=submit]` → wait for `text=Organise`.
- Organise: `/organise?path=Trips/Bikers`, wait for `.tile`. Batch buttons are under `.batchbar` (the filter panel also has a "GPS" heading, so scope your selectors).
- Dialogs: click "Preview changes" and wait for `table.table` (dry-run table).
- Collect `console` errors. A single 401 from `/api/auth/me` before login is expected.

Look at the screenshots; a rendered shell with empty panes usually means an API error.

## Fixture files (`fixtures/`, regenerate with `scripts/make-fixtures.sh`)

`Trips/Bikers`: a camera JPEG with offset+GPS, a 3-shot same-second burst (GPS → Africa/Cairo), a stripped WhatsApp JPEG, a JPEG without GPS plus an mtime mismatch, a screenshot PNG, MP4 (UTC + GPS), a stripped WhatsApp MP4, and a MOV. `Family`: a HEIC (macOS only) and an already-renamed JPEG. `import/`: a WhatsApp JPEG; `Phone/` has a JPEG and an MP4.
