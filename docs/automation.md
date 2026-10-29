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
| `copyMetadata` | `source, groups, tags` | UI only |
| `editTags` | `tags` | UI only |
| `move` | `dest` | |
| `moveByDate` | `pattern` e.g. `{YYYY}/{YYYY}-{MM}` | into `/media` |
| `trash` | — | UI only |

Steps run in order on a simulated file state, so later steps see earlier renames, moves and date writes in the dry run too.

**Adding a step**: see the `add-automation-step` skill.
