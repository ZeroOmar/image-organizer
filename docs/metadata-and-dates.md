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
| `videoCodec` | — | CompressorID → `h264`/`hevc`/`av1`/`other` (`videoCodecOf`) |
| `bitrate` | — | Composite AvgBitrate (bps) |
| `orientation` | EXIF Orientation 1–8 | — |
| `rotation` | HEIC/HEIF only: `irot` (QuickTime:Rotation, counter-clockwise quarter turns) → clockwise degrees | track matrix Rotation (clockwise degrees) |
| `lens` | LensModel | — |

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
- **Rotate / mirror** (`orientTags()`, lossless, numeric `-n`): JPEG → EXIF `Orientation`, composed with the current value by `rotateOrientation()`/`mirrorOrientation()` in `packages/shared/src/orientation.ts` (the eight values are the eight rotate/flip poses). HEIC → `QuickTime:Rotation` (irot), plus EXIF `Orientation` when the file has one, so the two agree. Videos → `Rotation` (track matrix). HEIC and videos can't be mirrored: ExifTool can't add an HEIF `imir` property. The dialog offers HEIC → JPG first in the same job. PNG/WebP are skipped because browsers don't reliably honor their EXIF orientation.
- All writes use `-overwrite_original -P`. File mtime is preserved; "Sync file dates" sets it explicitly.
- **Broken EXIF pointers**: some apps leave EXIF offsets (e.g. IFD0 `OtherImageStart`) that point past the end of the file, and ExifTool then refuses every write with "Error reading OtherImageStart data in IFD0" (not ignorable with `-m`). `Metadata.write()`/`copyFrom()` catch that error, rebuild the metadata once (`-all= -tagsFromFile @ -all:all -unsafe -icc_profile`, ExifTool FAQ 20: every readable tag, the maker notes and the ICC profile are kept; only the dangling pointer is dropped) and retry. The job records a note ("Repaired broken EXIF …").

## Undo snapshots

Thumbnails are cached by path, size, mtime, **ctime** and file size, and the web app versions thumbnail/file URLs with `ctimeMs` (`MediaEntry.ctimeMs`), because tag writes keep mtime and an Orientation change usually keeps the size too.

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
| `frontCamera` | orientation | photo from a front (selfie) camera (`LensModel` contains "front", as iPhones write) whose Orientation isn't mirrored yet. Phones don't record whether a selfie was saved mirrored, so this flags every unmirrored selfie; mirroring clears it, and the check can be turned off in Settings |

UI: mismatch → red outline, missing → yellow outline, name/orientation → grey badge. They can be toggled per check in Settings. **Adding a check**: add the id to `ISSUE_CHECK_IDS` (settings.ts) and an entry to `ISSUE_CHECKS`; the Settings page and Issues facet pick it up automatically.
