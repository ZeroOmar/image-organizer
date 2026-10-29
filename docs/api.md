# HTTP API

All routes are under `/api`. Auth: signed `io_session` cookie. Every non-GET request needs the header `X-Requested-With: image-organizer`. Errors are `{ "error": string }` with a 4xx/5xx status. Shared types are in `packages/shared/src/api.ts`.

`FileRef = { root: 'media'|'import'|'trash', rel: string }` (POSIX, relative, no leading slash).

## Auth
| | |
|---|---|
| `POST /auth/login` `{username,password}` | sets cookie → `{username}`; 10/min/IP |
| `POST /auth/logout` | |
| `GET /auth/me` | `{username}` or 401 |
| `GET /health` | public |

## Browse
| | |
|---|---|
| `GET /tree?root&rel` | `TreeNode[]` (child folders, `hasChildren`) |
| `GET /folder?root&rel&recursive=0\|1` | `FolderListing` (`dirs`, `entries: EnrichedEntry[]` with `resolved` + `issues`) |
| `GET /entry?root&rel` | `EnrichedEntry` |
| `GET /metadata?root&rel` | all tags grouped by family-1 group |
| `POST /folders` `{root,rel,name}` | create a folder → `FileRef` |
| `GET /thumb?root&rel&size=64..2048` | JPEG (cached) |
| `GET /file?root&rel[&download=1]` | original bytes with Range support; HEIC/HEIF → JPEG preview unless `download=1` |

## Jobs
| | |
|---|---|
| `POST /jobs/plan` `JobRequest` | `PlanResult` (dry run) |
| `POST /jobs` `JobRequest` | `JobInfo` (queued) |
| `GET /jobs` | last 50 `JobInfo` |
| `GET /jobs/:id` | `JobInfo` |
| `POST /jobs/:id/undo` | `JobInfo` of the undo job |
| `GET /events` | SSE, `event: job` with `JobInfo` on every update |

`JobRequest = { title?, selection: {files: FileRef[]} | {folder: FileRef, recursive?}, steps: Step[] }`.

## Import
| | |
|---|---|
| `POST /import/upload?rel&lastModified` | multipart, one `file` → `FileRef` |
| `GET /import/count` | `{count}` |

## Admin
| | |
|---|---|
| `GET /config` | `PublicConfig` (map, default tz, limits, roots) |
| `GET /config/static` | merged static config, secrets masked |
| `GET /settings` · `PUT /settings` | `Settings` |
| `GET /trash` | `TrashItem[]` |
| `POST /trash/restore` `{ids}` | `{restored: FileRef[]}` |
| `POST /trash/purge` `{ids}` or `{all:true}` | `{purged}` |
| `GET /rules` · `POST /rules` · `PUT /rules/:id` · `DELETE /rules/:id` | `Rule` |
| `POST /rules/:id/run` | `JobInfo` |
| `POST /rules/:id/plan` | `PlanResult` |
