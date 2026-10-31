# UI

React 19 + Vite, React Router, TanStack Query, react-resizable-panels v4, react-leaflet v5. Styling is plain CSS: `apps/web/src/theme/tokens.css` + `app.css`.

## Design (from `design.md`, Nomad Green identity)

- Dark only. Surfaces lift `--canvas` (#000) → `--surface-1` → `--surface-2` → `--surface-3`, with 1px hairlines and **no shadows**.
- Accent = Nomad green `--accent` #00ca8e with **dark text** (`.btn-primary`). Links use `--link`. Warnings/errors use `--warning`/`--error`.
- Inter 500/600/700 (bundled via `@fontsource/inter`). Display text is tight, body text relaxed. Uppercase `.eyebrow` labels head every section and pane.
- 8px radius for buttons and inputs (`--r-md`), 12px for cards (`--r-lg`), pills for chips.
- Logo: `apps/app-icon.svg` via `@brand/app-icon.svg` (`components/Logo.tsx`). Vite's `brandIcons` plugin serves and emits `/app-icon.svg`, `/apple-touch-icon.png`, `/icon-512.png` and `/manifest.webmanifest`. Never reuse the logo's colors in the UI.

## Pages (`src/pages`)

| Route | Page |
|---|---|
| `/login` | `Login` |
| `/` | `Home`: cards Import (pending count), Organize (green), Automation, Immich (TBA, disabled), Settings |
| `/import` | `Import`: Workspace on root `import` + Upload/drag-drop + Move to album |
| `/organize?path=` | `Organize`: Workspace on root `media` + batch bar |
| `/automation` | rules list + editor + dry run |
| `/trash` | restore / delete / empty |
| `/settings` | dynamic settings + read-only static config |
| `/immich` | placeholder |

## Workspace (`src/organize/Workspace.tsx`)

```
┌ Folders (tree) ┬ breadcrumb · toolbar · Subfolders · Sort ┬ Preview  ┐
├────────────────┤ ContentGrid (tiles, issue outlines)       ├──────────┤
│ Filter facets  │ BatchBar                                  │ Metadata │
│                │ StatusBar (counts, issues, size slider)   │ All tags │
└────────────────┴───────────────────────────────────────────┴──────────┘
```

- Every split is a `Group`/`Panel`/`Separator`; layouts persist with `useDefaultLayout({id, storage: localStorage})` per root.
- The current folder lives in the URL (`?path=`). Selection: click, Cmd/Ctrl-click, Shift-click, Cmd+A, Esc, arrow keys, and "Select all" / "Clear" in the status bar.
- Touch (tablets): a tap toggles a tile in the selection (like Cmd-click), and a tap on empty space doesn't clear it. A long-press opens the context menu.
- Context menu (`components/ContextMenu.tsx`): right-click or long-press a tile. It lists the page's batch actions, then Select all, Select range to here and Clear selection. A tile outside the selection replaces it (mouse) or joins it (touch). Pages pass `actions(api)` (a `BatchAction[]`) to `Workspace` and render the BatchBar buttons from the same list with `actionButtons()`, so the bar and the menu stay in sync.
- Filters (`filters.ts`) are computed client-side from the listing: OR within a facet, AND across facets.
- The page passes `batchBar(api)` (and optionally `toolbar(api)`) render props; `WorkspaceApi` gives `selected`, `selection` (FileRefs), `focused`, `entries`, `folder`.

## Inline metadata editing

Pass `onEditGps` to `Workspace` to enable it (Organize does; Import stays read-only).

- Click a value in the Metadata panel (`organize/EditableValue.tsx`) to edit it. Enter saves, Esc cancels, and an empty value deletes the tag.
- **Summary** edits fixed tags (DateTimeOriginal, OffsetTimeOriginal, CreateDate, video QuickTime/Keys dates, Make, Model, LensModel, XMP Rating/Subject), with format validation.
- **All tags** edits any tag as `Group:Tag` (family-1 group). The Composite/File/System/ExifTool groups are read-only.
- Like Bridge, an edit applies to the whole selection when it includes the shown file, otherwise to that file only. It runs as an `editTags` job via `runJobAndWait()`, so it can be undone from the Jobs menu, and ExifTool errors appear under the field (`Metadata.write` throws when a value couldn't be written).
- GPS uses the map dialog ("Add location" / "Edit on map").

## GPS dialog

A file with GPS opens on its position. Otherwise the dialog asks for the browser's current location (`navigator.geolocation`) and marks it. That needs a secure context: HTTPS behind the proxy, or `localhost`/`127.0.0.1` locally. If permission is denied, pick on the map, search, type coordinates or copy from a file. "Use my location" re-runs the lookup.

## Batch actions

Every action dialog wraps `components/ActionDialog.tsx`: form → **Preview changes** (`/api/jobs/plan`, `PlanTable`) → **Apply** (`/api/jobs`). Progress, Undo and Dismiss live in the header `JobsMenu` (`components/JobsMenu.tsx`, SSE-fed; dismissals persist in localStorage; running jobs can't be dismissed). Dialogs live in `src/organize/dialogs/`.

## Data hooks (`src/api/hooks.ts`)

Query keys: `me, config, settings, tree, folder, metadata, jobs, trash, rules, importCount`. `useJobEvents` keeps `jobs` current and calls `invalidateFiles()` when a job finishes.
