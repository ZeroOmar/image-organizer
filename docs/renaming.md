# Renaming

Engine: `packages/shared/src/template.ts` (pure, used for the server plan and the Settings preview).

## Templates

Each media type has a template (Settings → Rename templates; stored in `settings.rename.templates`). The Rename dialog can override them for a single run (`{type:'rename', templates}`).

Default for both: `{YYYY}{MM}{DD}_{HH}{mm}{ss}{XX}_{TYPE}` → `20261008_094004_PIC.jpg`.

| Token | Value |
|---|---|
| `{YYYY} {YY} {MM} {DD} {HH} {mm} {ss} {SSS}` | Resolved local capture time |
| `{XX}` | Conflict counter (empty when unique) |
| `{TYPE}` | `settings.rename.typeLabels[kind]` (PIC / VID) |
| `{orig}` | Current base name |
| `{make} {model}` | Camera, sanitized |
| `{folder}` | Containing folder name |
| `{tz}` | Offset like `+0300` |

Validation (`parseTemplate`): unknown tokens, `/ \ : * ? " < > |`, empty templates, and templates with no date token and no `{orig}` are rejected.

**Adding a token**: add it to `TEMPLATE_TOKENS` and to the `v` map in `renderParts()`; add a test in `template.test.ts`.

## Conflict numbering (`planRenames`)

- The planner groups files by `(dir, rendered name with empty counter + normalized ext)`, case-insensitive.
- A group of 1 whose name isn't taken keeps the plain name.
- Otherwise **every** file in the group is numbered from `counter.start` with `counter.digits`, ordered by capture instant (including sub-seconds), then by current name. Numbers whose result already exists in the directory (files outside the batch) are skipped.
- A template without `{XX}` appends `_NN` on conflict.
- Re-running is stable: correctly named files produce no changes.

## Extensions

`normalizeExtension()`: the `settings.extensions.map` entry wins (default `.jpeg/.jpe → .jpg`, `.m4v → .mp4`), otherwise the extension is lower-cased when `lowercase` is on.

## Execution

All renames of one step run two-phase in the engine (`renameBatch`): first every file → `.io-tmp-<uuid>` in the same directory, then temp → final with `moveFile()` (never overwrites). Swapped names therefore can't collide. Each rename records an undo `move`.

Moves (`move`, `moveByDate`, import → album) don't use the template; collisions get `name_1.ext`. To get template names in the destination, put a `rename` step **after** the move (the Import dialog does this).
