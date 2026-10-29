# Architecture

## Container layout

| Path | What |
|---|---|
| `/opt/app` | Application code (`apps/server/dist`, `apps/web/dist`, `packages/shared/dist`, `node_modules`) |
| `/app` | Volume: `config.yaml` (merged static config), `data/app.db` (SQLite), `cache/thumbs/` |
| `/media` | Library root (`media`) |
| `/import` | Incoming media root (`import`) |
| `/trash` | Trash root (`trash`); usually a different device, so moves use copy → verify → unlink |

`APP_DIR` overrides `/app`; `media.root`/`import.root`/`trash.root` in config override the others (the local runner uses `.local-test/*`).

## Startup (`apps/server/src/main.ts`)

1. `loadConfig()` reads `/app/config.yaml`, deep-merges `APP_CONFIG` over it (env wins), validates it with zod, and writes it back.
2. `createContext()` (`bootstrap.ts`) opens the DB and runs migrations, `Roots.init()` (creates and checks roots, returns device ids), and wires the services.
3. Purges trash past retention (and again daily at 03:00), starts automation (cron + watchers), then listens.

## Services (`AppContext`, `context.ts`)

| Service | File | Responsibility |
|---|---|---|
| `Roots` | `fs/roots.ts` | `(root, rel)` → absolute path; rejects `..`, symlink escapes |
| `Metadata` | `metadata/exiftool.ts` | ExifTool pool (exiftool-vendored, 4 procs): read, grouped read, snapshot, write, copy, embedded preview |
| `Indexer` | `index/indexer.ts` | `getEntry()` = stat + cached metadata (SQLite `media_cache`, keyed by size+mtime); `enrich()` adds `resolved` + `issues` |
| `Thumbs` | `thumbs/thumbs.ts` | JPEG thumbs/previews cached in `/app/cache/thumbs` (sharp → ffmpeg → embedded JPEG) |
| `Trash` | `trash/trash.ts` | `/trash/<origin>/<rel>` + `trash_items` rows; restore/purge |
| `JobEngine` | `jobs/engine.ts` | Plans and executes jobs serially; undo; emits `job` events for SSE |
| `Automation` | `automation/automation.ts` | Rules CRUD, croner schedules, chokidar watchers |
| `SettingsStore` | `settings/store.ts` | Dynamic settings JSON row |

## Job engine

```
JobRequest { selection: {files[]} | {folder, recursive}, steps: Step[] }
   │ expandSelection → FileRef[]
   │ planJob: for each step, simulate on in-memory VFiles → PlanItem[] (dry run) + Op[]
   ▼
POST /api/jobs/plan → PlanResult (nothing changes)
POST /api/jobs      → plan again, insert job row, queue execute()
   execute(): ops in order; renames of one step run two-phase (temp names first)
              each op pushes an UndoEntry; errors are collected per file, not fatal
POST /api/jobs/:id/undo → new job applying UndoEntries in reverse
```

Op kinds: `writeTags` (with snapshot), `copyTags`, `rename`, `move`, `utimes`, `trash`. Jobs run one at a time (single promise chain), so batches never race. Jobs still `running` at restart are marked `failed`.

## SQLite schema (`db/db.ts`, append-only `MIGRATIONS`)

- `sessions(id, username, created_at, expires_at)`
- `settings(key, value JSON)`: one row `app` = `SettingsSchema`
- `media_cache(root, rel, size, mtime_ms, meta JSON, error)`
- `jobs(id, title, status, request JSON, total, done, errors JSON, undo JSON, rule_id, created_at, finished_at)`
- `trash_items(id, origin_root, original_rel, trash_rel, size, deleted_at)`
- `rules(id, data JSON, last_run_at, last_job_id)`

To change the schema, **append** a new migration string; never edit an old one.

## Request flow and auth

- Every `/api/*` request except `login` and `health` needs a valid signed `io_session` cookie (a SQLite session).
- Every non-GET `/api/*` request needs the header `X-Requested-With: image-organizer` (CSRF, on top of SameSite=Strict).
- Login is rate-limited to 10/min per IP. Fastify uses `trustProxy: true`; the cookie is `Secure` when `X-Forwarded-Proto` is https.
- The web build is served by `@fastify/static` with an SPA fallback.

## Web

React Query for data, SSE (`/api/events`) for job progress; finishing a job invalidates the `folder`/`tree`/`metadata`/`trash` queries. See [ui.md](ui.md).
