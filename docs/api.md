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

## Folders
| | |
|---|---|
| `POST /folders/plan` `FolderJobRequest` | `PlanResult` (dry run) |
| `POST /folders/apply` `FolderJobRequest` | `JobInfo` (queued); undo like any job, except `delete` |

`FolderJobRequest = { folder: FileRef, op }`, with `op` one of:
- `{type:'rename', name}`
- `{type:'move'|'copy', dest: FileRef}`: `dest` is the new parent, in media or import.
- `{type:'trash'}` or `{type:'delete'}`: `delete` is permanent and not undoable.
- `{type:'chmod', dirMode?, fileMode?, recursive}`: modes are octal strings such as `"755"`.
- `{type:'chown', uid?, gid?, recursive}`

A root itself can only be chmod/chown'ed, and folders in the trash are refused. A chmod or chown the app's user isn't allowed to make (not root, not the owner, a group it isn't in) appears as an error row in the dry run and is skipped.

## Jobs
| | |
|---|---|
| `POST /jobs/plan` `JobRequest` | `PlanResult` (dry run) |
| `POST /jobs` `JobRequest` | `JobInfo` (queued) |
| `GET /jobs` | last 50 `JobInfo` |
| `GET /jobs/:id` | `JobInfo` |
| `POST /jobs/:id/undo` | `JobInfo` of the undo job (`done` or `cancelled` jobs with undo entries) |
| `POST /jobs/:id/cancel` | `JobInfo`; stops a queued or running job (kills a running ffmpeg encode); 409 otherwise |
| `GET /events` | SSE, `event: job` with `JobInfo` on every update, and `event: scan` with `DupeScan` (no `groups`) for duplicate-scan progress |

`JobRequest = { title?, selection: {files: FileRef[]} | {folder: FileRef, recursive?}, steps: Step[] }`.

`JobInfo` also carries `lane` (`main` | `convert`), `current` (`{file, pct}` while a video is encoding), `notes` (per-file outcomes that aren't errors) and `savedBytes`. `/config` includes `convertAvailable` (ffmpeg has libx265).

## Duplicates
| | |
|---|---|
| `POST /dupes/scan` `{folder: FileRef, recursive?, mode: exact\|near\|similar, threshold?}` | `DupeScan` (running); 409 while another scan runs |
| `GET /dupes/scan?threshold` | latest `DupeScan` with `groups: DupeGroup[]` (`{files: EnrichedEntry[], keep, similarity}`), or `null`. `threshold` regroups a finished near/similar scan; files gone since the scan are left out |
| `POST /dupes/cancel` | `DupeScan` or `null` |

Scanning is read-only; resolving a group is a normal `trash` job. See [duplicates.md](duplicates.md). `/config` includes `similarAvailable`.

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
