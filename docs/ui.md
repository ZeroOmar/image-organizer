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
| `/` | `Home`: cards Import (pending count), Organize (green), GPS, Convert, Duplicates, Automation, Immich (TBA, disabled), Settings |
| `/import` | `Import`: Workspace on root `import` + Upload/drag-drop + Move to album |
| `/organize?path=` | `Organize`: Workspace on root `media` + batch bar |
| `/gps?root=&path=` | `Gps`: Workspace with a file list + map (root `media`, or `import` with `?root=import`) |
| `/convert?root=&path=` | `Convert`: Workspace with a video table (codec, bitrate, size, candidate status) + Conversion pane (totals, progress with Cancel, savings); see [convert.md](convert.md) |
| `/duplicates?root=&path=` | `Duplicates`: Workspace with duplicate groups (Keep checkboxes, Best pill) + Scan pane (mode, threshold, progress with Cancel, totals); see [duplicates.md](duplicates.md) |
| `/automation` | rules list + editor + dry run |
| `/trash` | restore / delete / empty |
| `/settings` | dynamic settings + read-only static config |
| `/immich` | placeholder |

## Workspace (`src/organize/Workspace.tsx`)

```
┌ Folders ☐Subf. ┬ breadcrumb · toolbar · Sort              ┬ Preview  ┐
│ (tree)         │                                           │          │
├────────────────┤ ContentGrid (tiles, issue outlines)       ├──────────┤
│ Filter facets  │ BatchBar                                  │ Metadata │
│                │ StatusBar (counts, issues, size slider)   │ All tags │
└────────────────┴───────────────────────────────────────────┴──────────┘
```

- Every split is a `Group`/`Panel`/`Separator`; layouts persist with `useDefaultLayout({id, storage: localStorage})` per root.
- The current folder lives in the URL (`?path=`) and is remembered per root in localStorage (`io.<root>.folder`): opening any Workspace page without `?path=` returns to the last folder. Selection: click, Cmd/Ctrl-click, Shift-click, Cmd+A, Esc, arrow keys, and the "Select all" / "Clear" buttons next to Sort in the content toolbar (on GPS, in the Files pane header; `sidePane.selectionTools`). They grow to 44px touch targets on coarse pointers.
- Selection checkbox (`organize/SelectCheck.tsx`): every grid tile and list row (GPS Files list, Convert table) has one. It toggles the file like Cmd/Ctrl-click (Shift-click on it adds the range). On touch the tile checkbox is always shown; with a mouse it appears on hover and on selected tiles.
- Touch (tablets): a tap selects only that file, like a click, so a stray tap can't add files to a batch edit. Multi-select with the checkboxes. A tap on empty space doesn't clear the selection. A long-press opens the context menu.
- Context menu (`components/ContextMenu.tsx`): right-click or long-press a tile. It lists the page's batch actions, then Select all, Select range to here and Clear selection. A tile outside the selection replaces it, like Finder. Pages pass `actions(api)` (a `BatchAction[]`) to `Workspace` and render the BatchBar buttons from the same list with `actionButtons()`, so the bar and the menu stay in sync.
- Preview (`PreviewPane.tsx`): the focused file, or with several selected a fanned stack of up to 5 thumbnails (focused on top, green border) and the count. Cmd/Ctrl-click (or a checkbox) that deselects a file moves focus to the last remaining selected file, so Preview and Metadata never show a file that left the selection.
- Folder menu: right-click or long-press a folder in the Folders pane (every Workspace page, not the trash).
  - Items: **Rename**, **Move to…**, **Copy to…** (destination in Media or Import), **Permissions (chmod)**, **Owner (chown)** and **Move to trash**.
  - Holding Shift turns the last item into **Delete permanently**; the trash dialog also has a checkbox for it.
  - The root folder only offers chmod/chown.
  - Dialogs are in `organize/dialogs/FolderDialogs.tsx` and use `ActionDialog` with a `runner` (`/api/folders/plan` → `/api/folders/apply`).
  - When the job finishes, the Workspace follows a renamed or moved folder, or goes to the parent of a trashed one, if you were inside it.
- Filters (`filters.ts`) are computed client-side from the listing: OR within a facet, AND across facets.
- The page passes `batchBar(api)` (and optionally `toolbar(api)`) render props, an optional `statusTools` node that replaces the thumbnail Size slider, plus an optional `folderTools` node shown in the Folders pane header next to the **Subfolders** checkbox; `WorkspaceApi` gives `selected`, `selection` (FileRefs), `focused`, `entries`, `folder`.

## Phone layout (≤ 768px)

`components/useCompact.ts` (`useIsCompact()`) switches the layout; the routes, API, jobs and dialogs are the same.

```
┌ logo · Page title          Jobs ┐  TopNav compact
├ ‹  Bikers ▾              Select ┤  folder button opens the Folders sheet
│    media › Trips · 10 items     │
├ Upload Filter Sort  issues  − + ┤  toolbar · side-pane sheet · Sort · columns
│ ▢ ▢ ▢                           │  ContentGrid, 2–5 columns
│ ▢ ▢ ▢                           │
├ Rename  Dates  GPS  ⋯           ┤  batch bar (only while selecting)
└ Organize  Import  GPS  More     ┘  TabBar (hidden while selecting)
```

- Shell: `TopNav compact` shows the page title and Jobs. `components/TabBar.tsx` holds Organize · Import · GPS, and More opens a `Sheet` with the other pages and Sign out. Safe-area insets are applied (`viewport-fit=cover`).
- Workspace: one column. Folders and the Filter (or the page's `sidePane`) open as bottom sheets (`components/Sheet.tsx`). The column count is stored in `io.thumbCols`.
- Selection mode: start it with **Select**, a long-press, or a tile checkbox. While selecting, a tap toggles a file, the header shows "✕ N selected · All", and `body.io-selecting` hides the tab bar. Outside selection mode a tap opens the viewer.
- Viewer (`organize/Viewer.tsx`): full screen. Swipe left/right (or ‹ ›, arrow keys) between the visible files; swipe up or tap **Info** for the Metadata / All tags panel, with inline editing on Organize; swipe down or ✕ closes it. **Select** switches to selection mode with that file selected.
- Batch bar: `actionButtons()` shows the first 3 actions and puts the rest (Trash last) in a ⋯ menu.
- Dialogs are full screen, with the footer pinned. `PlanTable` shows one card per change instead of the table.
- Custom panes get `api.compact` and `api.view(rel, list?)`. On phones `api.pick` toggles while selecting, so list rows and map markers behave like grid tiles.
- GPS: `sidePane.dock` shows the Files list as a `DockSheet` under the map. It stays usable alongside the map: tap its handle to cycle peek / half / full, or drag it. Place mode works by selecting files in the list, then tapping the map. Map hints use touch wording. The fit padding is capped to 20% of the map size, so a short map still fits the markers. The Zoom slider (`statusTools`) is desktop only; on phones you pinch.
- Convert: the video table becomes cards (name; length · resolution · codec; bitrate · size; status pill).
- Duplicates: each group's files scroll sideways. A tap opens the viewer on that group.
- Trash: one card per item, plus Select all. Settings and Automation keep their layouts; inputs are capped at the screen width and page headings take their own line.

## Inline metadata editing

Pass `onEditGps` to `Workspace` to enable it (Organize does; Import stays read-only).

- Click a value in the Metadata panel (`organize/EditableValue.tsx`) to edit it. Enter saves, Esc cancels, and an empty value deletes the tag.
- **Summary** edits fixed tags (DateTimeOriginal, OffsetTimeOriginal, CreateDate, video QuickTime/Keys dates, Make, Model, LensModel, XMP Rating/Subject), with format validation.
- **All tags** edits any tag as `Group:Tag` (family-1 group). The Composite/File/System/ExifTool groups are read-only.
- Like Bridge, an edit applies to the whole selection when it includes the shown file, otherwise to that file only. It runs as an `editTags` job via `runJobAndWait()`, so it can be undone from the Jobs menu, and ExifTool errors appear under the field (`Metadata.write` throws when a value couldn't be written).
- GPS uses the map dialog ("Add location" / "Edit on map").

## GPS page (`src/pages/Gps.tsx`, `src/gps/`)

Uses the same `Workspace`, with two of its panes swapped out: `sidePane` puts the **Files** list (`FileList.tsx`) where the Filter pane is, and `content` puts the map (`GpsMap.tsx`) where the grid is. The pages share selection through `WorkspaceApi.pick/setSelection/focusRel`, which use `organize/useSelectClick.ts`, the same click rules the grid uses, checkbox toggling included. Right-clicking a row opens the same context menu as a grid tile, through `WorkspaceApi.openMenu`. A **Media | Import** switch in the Folders pane header (`folderTools`) sets `?root=`.

- **Files**: All / No GPS / With GPS. Rows click-select, scroll into view when their marker is picked, and can be dragged onto the map.
- **Map**: one marker per geotagged file, zoomed to fit once per folder (and on **Fit**). Marker colors come from `tokens.css`. Clicking a marker selects the file, and the list and Preview follow. Selected and focused markers sit in their own Leaflet panes above the rest (with a pulsing halo), so they stay visible inside a dense cluster. Whenever the selection or focus changes, the map goes to the highlighted file (zooming in to street level, but never out when already closer) or fits all highlighted files. The status bar's Zoom slider (in place of the thumbnail Size slider) follows and sets the map zoom.
- **Select / Place / Circle** modes:
  - **Place**: click the map (or drop a list row on it) to drop a draggable pin for the selected files, then **Apply** runs `setGps`.
  - **Circle**: press-and-drag (mouse or touch) to draw a circle, and the geotagged files inside are selected (Shift adds). **Tighten** previews the new positions (yellow) and **Apply** runs `gatherGps` toward their average or the circle center.
- Map applies run through `runJobAndWait()` right away, without a dry-run table, and can be undone from the Jobs menu. The batch bar's **Set GPS…**, **Tighten…** and **Clear GPS** use the usual `ActionDialog` dry run.
- Place search (Nominatim) is `components/PlaceSearch.tsx`, which the GPS dialog uses too.

## Convert page (`src/pages/Convert.tsx`)

Like the GPS page, it swaps two Workspace panes: `content` is a table of the folder's videos (thumbnail, length, resolution, codec, bitrate, size, Candidate/Already efficient/Low bitrate pill), filtered to **Candidates** by default, and `sidePane` is **Conversion** (candidate count and size, running conversions with % progress and **Cancel**, recent savings). Candidate rules come from `convertSkipReason()` in shared, the same function the planner uses. Rows click-select and right-click like grid tiles. **Select candidates** selects every candidate; **Convert to HEVC** opens `ConvertDialog` (quality CRF presets + slider, encoder preset), which Organize and Import use too. Organize and Import also have **HEIC to JPG** (`HeicToJpegDialog`, a quality slider), enabled when the selection has a HEIC/HEIF.

## Duplicates page (`src/pages/Duplicates.tsx`)

Like Convert, it swaps two Workspace panes.

The **Scan** side pane has:
- Mode tabs: Exact / Near-identical / Similar scene. Similar scene is hidden when `similarAvailable` is false.
- A loose → strict threshold slider.
- **Scan**, which uses the Workspace folder and its Subfolders checkbox (`WorkspaceApi.recursive`).
- Progress with **Cancel**, then the group count and how much would be trashed.

Releasing the slider after a scan regroups the result (`GET /api/dupes/scan?threshold=`).

The content pane has one `.dupe-group` card per group:
- Kept tiles are green-tinted; the auto-picked one has a **Best** pill.
- Clicking a thumbnail focuses the file in Preview/Metadata.
- **Keep all** spares a group, and **Trash N unkept** opens `TrashDialog` for just that group's unkept files.

The batch bar has **Auto-pick best** and **Move unkept to trash** (`TrashDialog`). After the job, `invalidateFiles()` refetches `dupes`, and trashed files drop out of the groups.

## Copy metadata dialog

The source is picked from a comparison table: one row per selected file (thumbnail, name, radio), one column per tag that will be copied. Values come from `/api/metadata` (`useMetadataMany`). Click a row to make it the source; target cells that differ from the source are highlighted because the copy will change them. The table shows at most 50 files (one ExifTool read each).

## GPS dialog

A file with GPS opens on its position. Otherwise the dialog asks for the browser's current location (`navigator.geolocation`) and marks it. That needs a secure context: HTTPS behind the proxy, or `localhost`/`127.0.0.1` locally. If permission is denied, pick on the map, search, type coordinates or copy from a file. "Use my location" re-runs the lookup.

## Batch actions

Every action dialog wraps `components/ActionDialog.tsx`: form → **Preview changes** (`/api/jobs/plan`, `PlanTable`) → **Apply** (`/api/jobs`). Progress (plus the current file's % for conversions), Cancel (convert lane), Undo and Dismiss live in the header `JobsMenu` (`components/JobsMenu.tsx`, SSE-fed; dismissals persist in localStorage; running jobs can't be dismissed). Dialogs live in `src/organize/dialogs/`.

## Data hooks (`src/api/hooks.ts`)

Query keys: `me, config, settings, tree, folder, metadata, jobs, trash, rules, importCount, dupes`. `useJobEvents` keeps `jobs` current and calls `invalidateFiles()` when a job finishes. It also merges `scan` events into the `dupes` queries and refetches them when a scan ends.
