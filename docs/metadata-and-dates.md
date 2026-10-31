# Metadata, dates and timezones

## Reading

`Metadata.readMeta()` runs `exiftool -n` (no groups) and normalizes the result to `MediaMeta` (`packages/shared/src/media.ts`):

| Field | Photo tag | Video tag |
|---|---|---|
| `dateTimeOriginal` | DateTimeOriginal (local wall time) | — |
| `createDate` | CreateDate (local) | — |
| `offsetTimeOriginal` / `offsetTime` | OffsetTimeOriginal / OffsetTime | — |
| `subSecTimeOriginal` | SubSecTimeOriginal | — |
| `qtCreateDate` | — | QuickTime CreateDate (**UTC**) |
| `qtCreationDate` | — | Keys:CreationDate (local + offset) |
| `gps` | Composite GPSLatitude/Longitude/Altitude (signed) | same (from GPSCoordinates) |

Invalid dates (`0000:00:00…`) are dropped. Raw values may carry sub-seconds (`…:04.100`); compare to the second.

The Metadata panel's **All tags** tab uses `readGrouped()` (`-G1 -a -s`, printed values).

## Date sources and resolution (`packages/shared/src/dates.ts`)

`dateCandidates(entry)` produces at most one candidate per source:

- `original`: photo DateTimeOriginal (+ offset, + sub-seconds); video Keys:CreationDate, falling back to the QuickTime UTC instant
- `create`: photo CreateDate; video QuickTime CreateDate (UTC instant)
- `filename`: `parseFilenameDate()`. Handles our own names, `IMG_YYYYMMDD_HHMMSS`, Pixel `PXL_…`, screenshots, and WhatsApp `IMG-YYYYMMDD-WA####` (**date only**)
- `fileModify`: file mtime (instant)

`resolveDate(entry, priority, defaultTz)`:

1. Pick the first source in the **configurable priority** list (Settings).
2. Pick the zone with `fileZone()`: the file's own offset → the GPS zone (`geo-tz`, offline, computed server-side as `entry.gpsTz`) → `timezone.default`.
3. Wall-time candidates keep their wall time (with their own offset when present); instants are converted into the zone.
4. Date-only candidates borrow the time of day from the next source that falls on the same local day; otherwise they use 00:00:00 with `dateOnly: true`.

The result carries `local`, `tz`, `offset`, `utcMs`, `source`, `tzSource` and `timeFrom`.

## Writing (`apps/server/src/metadata/tags.ts`)

- **Dates, photos**: DateTimeOriginal, CreateDate (local) + OffsetTimeOriginal/Digitized/OffsetTime.
- **Dates, videos**: QuickTime Create/Modify, Track*, Media* dates in **UTC** + `Keys:CreationDate` local with offset.
- **GPS, photos**: `GPSLatitude`/`GPSLongitude` as signed decimals, **not** `-n` (exiftool-vendored derives the refs and writes GPSPosition "lat,lon", which `-n` rejects and silently drops lat/lon). Altitude uses abs + `Above/Below Sea Level`.
- **GPS, videos**: `Keys:GPSCoordinates` + `UserData:GPSCoordinates` = `"lat lon alt"` with `-n`.
- `setGps` and `gatherGps` (tighten a cluster, from the GPS page) both write through `gpsTags()`. `gatherGps` computes each new point with the shared `gatherPoint()` and keeps the file's altitude.
- All writes use `-overwrite_original -P`. File mtime is preserved; "Sync file dates" sets it explicitly.

## Undo snapshots

Before each `writeTags`/`copyTags`, `Metadata.snapshot()` reads the printed (not `-n`) values of the tags about to change; missing tags are stored as `null` (undo deletes them). Snapshots are stored in the job's `undo` JSON.

## Issue checks (`packages/shared/src/issues.ts`)

| id | category | when |
|---|---|---|
| `missingOriginalDate` | missing | no DateTimeOriginal / QuickTime date |
| `missingGps` | missing | no GPS |
| `missingOffset` | missing | photo has a date but no OffsetTimeOriginal |
| `missingCamera` | missing | no make and no model |
| `dateMismatchFile` | mismatch | resolved date vs mtime > tolerance |
| `dateMismatchFilename` | mismatch | resolved vs date in name > tolerance (date-only names compare by day) |
| `nameOffTemplate` | name | name isn't what the template produces (any counter) |

UI: mismatch → red outline, missing → yellow outline, name-only → grey badge. They can be toggled per check in Settings. **Adding a check**: add the id to `ISSUE_CHECK_IDS` (settings.ts) and an entry to `ISSUE_CHECKS`; the Settings page and Issues facet pick it up automatically.
