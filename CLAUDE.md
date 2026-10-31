# Image Organizer: working notes

Self-hosted photo/video organizer (Docker, web UI). It automates a manual Adobe Bridge workflow: check and fix dates, timezone and GPS (social-media copies lose their metadata), then rename to `YYYYMMDD_HHMMSS[XX]_PIC|VID` (the templates are configurable). Also: an Import page (`/import` mount plus browser upload → move into albums), automation rules, and a trash on its own `/trash` mount.

## Repo map

```
packages/shared/   Pure TS used by server AND web: dates/TZ resolution, rename template engine,
                   issue checks, settings schema (zod), step/job schemas, media types.
apps/server/       Fastify API. src/
  config/          APP_CONFIG (env YAML) merged over /app/config.yaml (env wins) → zod
  db/              better-sqlite3, append-only MIGRATIONS
  fs/              Roots (path jail per root: media|import|trash), moveFile (cross-device safe), listings
  metadata/        ExifTool wrapper (the ONLY ExifTool user) + tag builders for dates/GPS
  index/           Metadata cache (SQLite, size+mtime) + enrich() = resolved date + issues
  jobs/            planner.ts (steps → dry-run items + ops), engine.ts (serial executor, undo)
  trash/ thumbs/ automation/ auth/ settings/
  http/routes/     browse, jobs, import, admin
apps/web/          React + Vite. src/
  theme/           tokens.css (design.md, Nomad green) + app.css (all styles)
  api/             fetch client + react-query hooks + SSE job events
  organize/        Workspace (resizable panes) shared by Organize & Import, grid, filters, dialogs
  pages/           Login, Home, Import, Organize, Automation, Immich (TBA), Settings, Trash
apps/app-icon.svg  The logo (single source; Vite emits favicon/PNGs from it)
fixtures/          Sample media (regenerate: scripts/make-fixtures.sh)
docker/            entrypoint (PUID/PGID via su-exec), hash-password
```

## Commands

```bash
npm test                         # vitest: shared unit tests + server integration (real exiftool/ffmpeg)
npm run typecheck                # all three packages
npm run build                    # shared → server → web
scripts/run-local.sh [--reset] [--prod]   # local run without Docker in .local-test/ (admin/admin)
npm run hash-password -- 'pw'    # bcrypt hash for admin.passwordHash
```

The server dev loop resolves `@io/shared` to TS source via the `development` export condition; the production build uses `packages/shared/dist`.

**Versioning and releases:** the version lives in every `package.json` (currently 0.2.1; keep them in sync). Push an annotated semver tag (`git tag -a 0.2.0 --cleanup=verbatim -F notes.md && git push origin 0.2.0`). `.github/workflows/docker-publish.yml` then builds amd64+arm64 → `ghcr.io/zeroomar/image-organizer:<ver>, :<major.minor>, :latest`, passing the tag as `APP_VERSION`, and `release.yml` publishes a GitHub Release from the tag message (there is no CHANGELOG.md). At runtime the version is `APP_VERSION`, falling back to the root `package.json` (`apps/server/src/version.ts`), and is exposed in `/api/health`, `/api/config`, Home and Settings.

**Committed vs ignored:** `docker-compose.example.yml` is the template; the real `docker-compose.yml` is git-ignored (secrets). `.local-test/`, `dist/`, `node_modules/` and the DB files are ignored. `.dockerignore` keeps the build context to sources only (no tests, fixtures, docs, images, `.claude`).

## Hard rules

1. **Paths**: always `roots.resolve({root, rel})`. Never join user paths yourself. Moves between roots happen only through import → media (the `move` step) and trash/restore.
2. **Mutations**: everything that changes files is a **step** run by the **job engine**: plan (dry run) → submit → serial execution → undo entries. Don't write files from route handlers. Trash restore/purge use `jobs.exclusive()`.
3. **Undo**: every op records an inverse (tag snapshot, reverse move, previous mtime, trash id). New ops must too.
4. **ExifTool**: only through `metadata/exiftool.ts`. Writes use `-overwrite_original -P` (keep mtime) and call `indexer.invalidate()` afterwards; the job engine already does this.
5. **GPS writes**: photos use signed decimals **without** `-n` (exiftool-vendored adds a GPSPosition that `-n` breaks). Videos (`Keys:GPSCoordinates`) need `-n`. See `metadata/tags.ts`.
6. **Dates**: EXIF dates are local wall time plus `OffsetTime*`; QuickTime dates are UTC. Resolve with `resolveDate()` from shared; never parse dates ad hoc.
7. **UI**: colors and spacing come only from `theme/tokens.css`. Dark only. The primary action is Nomad green with dark text. The logo's colors are never reused as UI colors.
8. **Settings vs config**: static config (env) is read-only in the UI; dynamic settings (`SettingsSchema`) live in SQLite and are edited on the Settings page.

## Where to read next

- [docs/architecture.md](docs/architecture.md): modules, request flow, job engine, DB schema, container layout
- [docs/configuration.md](docs/configuration.md): APP_CONFIG, merge rule, env vars, compose
- [docs/metadata-and-dates.md](docs/metadata-and-dates.md): tags, date sources, TZ resolution, issues
- [docs/renaming.md](docs/renaming.md): template tokens, conflict numbering, extensions
- [docs/import.md](docs/import.md): /import root, uploads, move to album
- [docs/automation.md](docs/automation.md): rules, steps, watcher, cron
- [docs/api.md](docs/api.md): every endpoint
- [docs/ui.md](docs/ui.md): pages, workspace layout, components, design tokens

Skills (`.claude/skills/`): `add-api-endpoint`, `add-batch-action`, `add-metadata-filter`, `add-automation-step`, `add-ui-component`, `run-and-verify`.
