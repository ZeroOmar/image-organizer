# Duplicates

The **Duplicates** page (`/duplicates`) scans a folder (plus subfolders when **Subfolders** is ticked) for copies and look-alikes. It shows them in groups, picks the best file of each group, and moves the rest to the trash with an ordinary `trash` job, which can be undone.

## Modes

| Mode | Files | How | Threshold |
|---|---|---|---|
| **Exact** | photos + videos | SHA-256 of the file bytes. Only files whose size matches another file's are hashed. | — |
| **Near-identical** | photos | 64-bit dHash (9×8 greyscale gradient) of the cached 320 px thumbnail, compared by Hamming distance. Finds resized or recompressed copies, such as WhatsApp or Instagram saves, whose bytes and metadata differ. | 0–16 differing bits, default 6 |
| **Similar scene** | photos | CLIP ViT-B/32 image embeddings of the thumbnail, compared by cosine similarity. Finds the same subject and framing taken at any time. | 80–98 %, default 90 % |

Near-identical and similar-scene scans hash from the thumbnail cache, so HEIC and other formats use the same decode fallbacks as thumbnails (sharp, then ffmpeg, then the embedded JPEG).

In a test with CLIP, a cropped, recoloured and mirrored copy of a photo scored 0.96. Unrelated photos scored 0.43–0.69, and plain graphics or solid-colour frames scored around 0.85. That's why the default is 0.90.

## Grouping (`apps/server/src/dupes/group.ts`)

Exact groups are equal hashes. Near-identical and similar-scene groups use **leader clustering**:
- Files are sorted by capture date.
- Each file not yet in a group starts one (it becomes the group's *seed*).
- Every later file that is within the threshold of that seed joins the group.

Comparing against the seed rather than any member stops a chain of slightly different shots from merging into one huge group. The cost is O(n²). Above 5,000 photos the scan adds a note suggesting a narrower folder.

`similarity` on a group is how alike its least similar member is to the seed: 1 − bits/64 for near-identical, the cosine for similar scene.

## Keeping the best file (`rankKeeper`, `packages/shared/src/dupes.ts`)

Files are compared field by field, and the first field that differs decides:
1. Larger picture (width × height).
2. Has a capture date (`DateTimeOriginal` / QuickTime dates).
3. Has a timezone offset.
4. Has GPS.
5. Larger file.
6. Name matches the rename template.
7. Shallower path.
8. Older file date.

So an original beats its social-media copy. Among byte-identical copies, the one with the clean name in the shallower folder is kept.

In the UI, each tile has a **Keep** checkbox. One file per group always stays. **Keep all** spares a whole group, and **Auto-pick best** resets the choices. **Move unkept to trash** opens the usual trash dialog (dry run, then apply).

## Scanner (`apps/server/src/dupes/scanner.ts`)

- **Read-only, not a job.** Scanning changes no files, so it runs beside the job engine rather than as a step. Only one scan runs at a time; a second gets 409.
- **Phases:** listing, then reading metadata (through the indexer cache), then loading the model (similar scene only), then hashing (4 at a time), then grouping.
- **Progress** is pushed as `event: scan` on `/api/events`, throttled to 250 ms.
- **Cancel** stops the scan between files.
- **Regrouping:** the last result is kept in memory. A new threshold regroups it without rehashing.
- **Gone files:** files that disappeared since the scan (trashed or moved) are left out of the groups, and come back if they reappear (e.g. after Undo).
- **Hash cache:** hashes are cached in `media_hash(root, rel, size, mtime_ms, sha256, dhash, clip)`.
  - Rows are valid while size and mtime match.
  - `Indexer.invalidate()` drops them along with `media_cache`, because ExifTool writes keep the mtime.
  - Rescans only hash new or changed files.

## The image model (`apps/server/src/dupes/clip.ts`)

- **Model:** `Xenova/clip-vit-base-patch32`, `onnx/vision_model_quantized.onnx` (~90 MB).
- **Download:** on the first similar-scene scan, it downloads to `/app/cache/models/`.
- **Runtime:** runs on **onnxruntime-web's WASM backend**. The Docker image is Alpine (musl), and `onnxruntime-node` ships only glibc binaries.
  - About 60 ms per photo on an Apple M-series CPU; slower on a NAS.
  - One-time per photo, since the embedding is cached.
- **Preprocessing:** resize/crop to 224 px, CLIP mean/std normalization, then L2-normalize the output.
- **Offline installs:** set `similar.modelPath` to a downloaded copy, or turn the mode off with `similar.enabled: false` (see [configuration.md](configuration.md)). `/api/config` reports `similarAvailable`.

The integration test for this mode downloads the model, so it only runs with `IO_TEST_CLIP=1 npm test`.
