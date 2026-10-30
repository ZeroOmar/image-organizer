# Import

`/import` (`import.root`) is a separate mount for incoming, unprocessed media. Files arrive in two ways:

1. **Dropped in from elsewhere**: any tool writing to the share (phone sync, scanner). They show up on the next folder load.
2. **Uploaded in the browser**: the Upload button or drag-and-drop on the grid.

## Upload (`POST /api/import/upload?rel=<dir>&lastModified=<ms>`)

- One file per request (the browser runs 2 in parallel with per-file progress via XHR).
- Streams to `.upload-<uuid>.part` (hidden) inside the target folder, then renames it to a unique name (`name_1.ext` on collision). Partial uploads never appear in listings or trigger watchers.
- Allowed: the supported media extensions. Size is limited by `import.maxUploadMB` (multipart `fileSize` limit → 413).
- The file's mtime is set from the browser's `lastModified`.

## Move to album

The Import page's primary action builds this job:

```
[applyDates?] → move {dest: media/<album>} → [rename?] → [syncFileDates?]
```

The rename runs **after** the move so numbering accounts for files already in the album. The folder picker can create the album folder. When the job finishes, an "Open album in Organize" link appears.

Cross-root rule: `move` only allows import → media (or within a root); anything else is an error item in the plan.

## Automation

A rule targeting `import` with **When files arrive** set watches the folder (chokidar, 2 s write-stability, 10 s settle) and runs its steps on just the new files. See [automation.md](automation.md).

## Home

`GET /api/import/count` (recursive) feeds the "N pending" pill on the Home page.
