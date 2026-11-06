import type { FileRef } from '@io/shared';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import type { DB } from '../db/db.js';

export type HashColumn = 'sha256' | 'dhash' | 'clip';
type HashValue = string | Buffer;

/**
 * Per-file hashes in media_hash, valid while size+mtime match (like media_cache). Each column is
 * filled only when a scan needs it; Indexer.invalidate() drops rows after metadata writes.
 */
export class HashStore {
  constructor(private db: DB) {}

  get(ref: FileRef, st: { size: number; mtimeMs: number }, col: HashColumn): HashValue | null {
    const row = this.db
      .prepare(`SELECT size, mtime_ms, ${col} AS v FROM media_hash WHERE root = ? AND rel = ?`)
      .get(ref.root, ref.rel) as { size: number; mtime_ms: number; v: HashValue | null } | undefined;
    return row && row.size === st.size && row.mtime_ms === st.mtimeMs ? row.v : null;
  }

  set(ref: FileRef, st: { size: number; mtimeMs: number }, col: HashColumn, value: HashValue): void {
    // A changed file makes the other columns stale too.
    this.db
      .prepare('DELETE FROM media_hash WHERE root = ? AND rel = ? AND (size != ? OR mtime_ms != ?)')
      .run(ref.root, ref.rel, st.size, st.mtimeMs);
    this.db
      .prepare(
        `INSERT INTO media_hash (root, rel, size, mtime_ms, ${col}) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(root, rel) DO UPDATE SET ${col} = excluded.${col}`,
      )
      .run(ref.root, ref.rel, st.size, st.mtimeMs, value);
  }
}

export async function sha256File(abs: string, signal?: AbortSignal): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(abs), h, { signal });
  return h.digest('hex');
}

/** 64-bit difference hash (9×8 greyscale, left < right) as 16 hex chars. */
export async function dhash(image: string): Promise<string> {
  const px = await sharp(image).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (px[y * 9 + x] < px[y * 9 + x + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** dHash hex → two 32-bit words for fast Hamming distance. */
export const dhashWords = (hex: string): [number, number] => [parseInt(hex.slice(0, 8), 16), parseInt(hex.slice(8), 16)];

const popcount = (n: number) => {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

export const hamming = (a: [number, number], b: [number, number]) => popcount((a[0] ^ b[0]) >>> 0) + popcount((a[1] ^ b[1]) >>> 0);
