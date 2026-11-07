# Video conversion

Phone videos are large (a 20-minute 1080p H.264 clip is ~3 GB at ~20 Mbps). The `convert` step re-encodes them to **HEVC (H.265)** with ffmpeg's libx265, at the same resolution, typically 3–10× smaller. It is available on the **Convert** page, as **Convert to HEVC** in the Organize/Import batch bar, and as an automation step.

## What the encode does (`apps/server/src/convert/ffmpeg.ts`)

`ffmpeg -i src -map 0:v:0 -map 0:a? -c:v libx265 -crf N -preset P -tag:v hvc1 -c:a copy -map_metadata 0 -movflags +faststart+use_metadata_tags -f mov|mp4 tmp`

- **Video**: the first video track, libx265 at the CRF/preset from the step (default: Settings → Video conversion, CRF 24, `medium`). `hvc1` tagging so Apple devices and browsers play it.
- **Pixel format and color**: kept from the source, so 10-bit HLG/HDR10 stays 10-bit with its color tags. **Dolby Vision** metadata (iPhone "HDR video") is not carried over; the HDR10/HLG base layer is.
- **Rotation**: ffmpeg bakes the display rotation into the frames, so a portrait video stays portrait (width/height are swapped, rotation becomes 0).
- **Audio**: every audio track is copied as-is.
- **Container**: same name and extension as the original (`.mov` → QuickTime, `.mp4`/`.m4v` → MP4).
- **Metadata**: ffmpeg carries the QuickTime/Keys tags. Then `Metadata.copyAllFrom()` runs `exiftool -tagsFromFile orig -all:all -unsafe` to copy everything else, e.g. Android `UserData:GPSCoordinates` (©xyz) and XMP, which ffmpeg drops. Dates (QuickTime UTC + Keys:CreationDate with offset), GPS, make/model and software survive. The file's mtime is set to the original's.
- **Availability**: `hasX265()` checks `ffmpeg -encoders` once; `/api/config` reports `convertAvailable`, the UI hides the action without it, and planning a convert step fails with 400.

## Which files are converted

`convertSkipReason()` in `packages/shared/src/convert.ts` (used by the planner and the Convert page):

| Rule | Setting (`convert.*`) | Default |
|---|---|---|
| Not a video | — | — |
| Codec already efficient (`MediaMeta.videoCodec`, from QuickTime `CompressorID`) | `skipCodecs` | `['hevc', 'av1']` |
| Bitrate below threshold (`AvgBitrate`, or size×8/duration) | `minBitrateMbps` | 10 |

Skipped files appear as plan **warnings** ("2 video(s) skipped: already HEVC/AV1"), not as rows. After encoding, if the result isn't at least `minSavingPct` (default 20%) smaller, it is discarded and the original is kept; the job records a **note** (`JobInfo.notes`), not an error.

## Execution: the convert lane (`jobs/engine.ts`)

A job whose steps include `convert` runs on a second serial lane (`convertChain`), so a long encode doesn't block renames, imports or automation on the main lane.

1. Encode to a hidden temp file in the same folder (`.io-convert-<uuid>.<ext>`, listed in the `convert_tmp` table). This only reads the original, so it runs alongside the main lane.
2. Too small a saving: delete the temp file and add a note.
3. Otherwise, on the main lane (`exclusive()`): check that the original's size and mtime haven't changed, copy all tags and the mtime over, **trash** the original, then move the temp file into its place. The undo entry is `{ t: 'replace', file, trashId }`.

Other ops in a convert-lane job (e.g. a rule "convert, then rename") also run through `exclusive()`, so no two jobs ever change files at the same time.

- **Progress**: ffmpeg's `-progress pipe:1` (`out_time_us` against the duration) sets `JobInfo.current = { file, pct }`, which is pushed over SSE (throttled to 250 ms).
- **Cancel**: `POST /api/jobs/:id/cancel` kills ffmpeg and removes the temp file. The job ends as `cancelled`. Files converted before the cancel keep their undo entries (cancelled jobs can be undone).
- **Undo**: moves the converted file to the trash and restores the original to its exact path. Nothing is deleted.
- **Restart**: interrupted jobs are marked `failed`, and the temp files listed in `convert_tmp` are deleted at startup.
- `JobInfo.savedBytes` sums the bytes saved by the files a job converted.

## Docker

The image's Alpine `ffmpeg` package includes libx265. Encoding is CPU-only and uses all cores; one file is encoded at a time. On a typical home server, 1080p at `medium` runs at about real time or slower; `fast`/`veryfast` are quicker, with somewhat larger files.

## HEIC to JPG

The `heicToJpeg` step (**HEIC to JPG** in the Organize and Import batch bars, and an automation step) saves HEIC/HEIF photos as JPEG for apps and sites that can't open HEIC. It is quick (about a second per photo), so it runs on the main lane like any other step.

- **Decode** (`apps/server/src/convert/heif.ts`): ffmpeg, because sharp's prebuilt libheif only has the AV1 (AVIF) decoder. ffmpeg assembles iPhone tile grids at full resolution and applies the HEIF rotation (`irot`/`imir`), so the pixels come out upright. It pipes an 8-bit PNG to sharp, which encodes the JPEG at the step's `quality` (default: Settings → Conversion → HEIC to JPG quality, 90). Pixel values are not color-converted.
- **Metadata**: `Metadata.copyAllFrom(heic, jpg, { icc: true, exclude: ['Orientation'] })` copies every tag plus the ICC profile (Display P3 on iPhones; `-all:all` alone skips it). EXIF `Orientation` is left out because the rotation is already applied to the pixels. The file's mtime is set to the original's.
- **Name**: same base name with `.jpg` in the same folder; a taken name becomes `name_1.jpg`. Later steps in the same job (e.g. rename) apply to the JPG.
- **Swap**: the JPG is written to a hidden `.io-convert-<uuid>.jpg` (listed in `convert_tmp`), moved into place, then the original is **trashed**. Undo entry `{ t: 'replace', file: <jpg>, trashId }`: undo trashes the JPG and restores the HEIC to its path.
- Files that aren't HEIC/HEIF are skipped with a plan warning.

