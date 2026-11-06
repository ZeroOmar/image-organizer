import { z } from 'zod';
import { FileRefSchema, type EnrichedEntry } from './api.js';
import type { FileRef } from './media.js';

/**
 * exact: same bytes (photos and videos). near: same picture resized/recompressed (dHash).
 * similar: same scene, any time (CLIP image embeddings).
 */
export const DUPE_MODES = ['exact', 'near', 'similar'] as const;
export type DupeMode = (typeof DUPE_MODES)[number];

/** near: max Hamming distance of 64-bit dHashes. similar: min cosine similarity of embeddings. */
export const DUPE_THRESHOLDS = {
  near: { min: 0, max: 16, step: 1, default: 6 },
  similar: { min: 0.8, max: 0.98, step: 0.01, default: 0.9 },
} as const;

export const DupeScanRequestSchema = z.object({
  folder: FileRefSchema,
  recursive: z.boolean().default(true),
  mode: z.enum(DUPE_MODES),
  threshold: z.number().optional(),
});
export type DupeScanRequest = z.input<typeof DupeScanRequestSchema>;

export interface DupeGroup {
  files: EnrichedEntry[];
  /** The file auto-picked to keep (see rankKeeper). */
  keep: string;
  /** 0–1: how alike the least similar member is to the group's first file (1 for exact). */
  similarity: number;
}

export type DupeScanStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface DupeScan {
  id: string;
  status: DupeScanStatus;
  folder: FileRef;
  recursive: boolean;
  mode: DupeMode;
  threshold: number;
  phase: 'listing' | 'reading' | 'hashing' | 'model' | 'grouping';
  done: number;
  total: number;
  /** Files compared (photos only for near/similar). */
  fileCount: number;
  startedAt: number;
  finishedAt: number | null;
  error?: string;
  note?: string;
  /** Present on GET /api/dupes/scan; left out of SSE progress events. */
  groups?: DupeGroup[];
}

export const defaultThreshold = (mode: DupeMode) => (mode === 'exact' ? 0 : DUPE_THRESHOLDS[mode].default);

const pixels = (e: EnrichedEntry) => (e.meta.width ?? 0) * (e.meta.height ?? 0);
const depth = (rel: string) => rel.split('/').length;

/** Higher is better, compared field by field. */
function keeperScore(e: EnrichedEntry): number[] {
  const m = e.meta;
  return [
    pixels(e),
    m.dateTimeOriginal || m.qtCreateDate || m.qtCreationDate ? 1 : 0,
    m.offsetTimeOriginal || m.offsetTime || m.qtCreationDate ? 1 : 0,
    m.gps ? 1 : 0,
    e.size,
    e.issues.some((i) => i.id === 'nameOffTemplate') ? 0 : 1,
    -depth(e.rel),
    -e.mtimeMs,
  ];
}

/**
 * The file to keep in a group: largest picture, then the one with capture date, offset and GPS
 * (social-media copies lose them), larger file, name matching the template, shallower path, oldest.
 */
export function rankKeeper(entries: EnrichedEntry[]): string {
  let best = entries[0];
  let bestScore = keeperScore(best);
  for (const e of entries.slice(1)) {
    const s = keeperScore(e);
    const i = s.findIndex((v, k) => v !== bestScore[k]);
    if (i >= 0 && s[i] > bestScore[i]) {
      best = e;
      bestScore = s;
    }
  }
  return best.rel;
}
