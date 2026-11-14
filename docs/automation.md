# Automation

A **rule** (`RuleSchema` in `packages/shared/src/api.ts`) is:

```ts
{ name, enabled, target: { folder: FileRef, recursive }, steps: Step[], schedule: cron | null, watch: boolean }
```

It is stored in the `rules` table. `Automation` (`apps/server/src/automation/automation.ts`) arms each enabled rule:

- **schedule** → `croner` (`protect: true`, so runs never overlap)
- **watch** → `chokidar` on the target folder (depth 0 unless recursive; hidden/temp files ignored; `awaitWriteFinish` 2 s). New files are batched for 10 s, then the rule runs on just those files.
- **Run now** (`POST /api/rules/:id/run`) always creates a job; scheduled and watched runs skip when the plan has no ops (`submit(..., {skipIfEmpty})`).
- **Dry run** (`POST /api/rules/:id/plan`) returns a `PlanResult` without running anything.

Every run is an ordinary job (`rule_id` set), so it shows in the header Jobs menu and can be undone.

## Steps

Steps are shared with the batch bar. `STEP_INFO` marks which ones the rule editor offers (`automation: true`).

| type | params | notes |
|---|---|---|
| `applyDates` | — | write resolved date + offset |
| `shiftDates` | `seconds` | |
| `setDate` | `local`, `tz` | UI only |
| `setTimezone` | `tz`, `keep: wall\|instant` | |
| `rename` | `templates?` | uses Settings templates |
| `syncFileDates` | — | mtime ← capture date |
| `setGps` / `clearGps` | `lat, lon, alt?` | |
| `gatherGps` | `lat, lon, scale` | UI only (GPS page): pulls positions toward a center, keeping `scale` of each distance; files without GPS are skipped |
| `copyMetadata` | `source, groups, tags` | UI only |
| `editTags` | `tags` | UI only |
| `move` | `dest` | |
| `moveByDate` | `pattern` e.g. `{YYYY}/{YYYY}-{MM}` | into `/media` |
| `trash` | — | UI only |
| `rotate` | `degrees: 90\|180\|270` (clockwise) | UI only (**Rotate & mirror**): lossless, through the orientation tag (JPEG EXIF Orientation, HEIC irot, video matrix); other formats are skipped with a warning ([metadata-and-dates.md](metadata-and-dates.md#writing-appsserversrcmetadatatagsts)) |
| `mirror` | `axis: horizontal\|vertical` | UI only: lossless EXIF Orientation flip, JPEG only; HEIC and videos are skipped with a warning (the dialog can prepend `heicToJpeg`) |
| `convert` | `crf?`, `preset?` | re-encode videos to HEVC; unset params use Settings → Conversion; runs on the convert lane; originals go to the trash ([convert.md](convert.md)) |
| `heicToJpeg` | `quality?` | save HEIC/HEIF photos as `<name>.jpg` (taken names get `_1`…), all metadata kept; unset quality uses Settings → Conversion; other files are skipped with a warning; originals go to the trash ([convert.md](convert.md#heic-to-jpg)) |

Steps run in order on a simulated file state, so later steps see earlier renames, moves and date writes in the dry run too.

**Adding a step**: see the `add-automation-step` skill.
