import {
  computeIssues,
  kindOf,
  resolveDate,
  type EnrichedEntry,
  type FileRef,
  type GpsPoint,
  type MediaEntry,
  type MediaMeta,
} from '@io/shared';
import { find as findTz } from 'geo-tz';
import fs from 'node:fs/promises';
import type { DB } from '../db/db.js';
import { dirOfRel, nameOfRel, type Roots } from '../fs/roots.js';
import { HttpError } from '../http/errors.js';
import type { Metadata } from '../metadata/exiftool.js';
import type { SettingsStore } from '../settings/store.js';

export function tzForGps(gps: GpsPoint | undefined): string | null {
  if (!gps) return null;
  try {
    return findTz(gps.lat, gps.lon)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Metadata index: ExifTool output cached in SQLite keyed by (root, rel) and validated by size+mtime.
 * Writes go through the job engine, which calls invalidate() because -P keeps mtime unchanged.
 */
export class Indexer {
  constructor(
    private db: DB,
    private roots: Roots,
    private metadata: Metadata,
    private settings: SettingsStore,
    private defaultTz: string,
  ) {}

  async getEntry(ref: FileRef): Promise<MediaEntry> {
    const { root, rel, abs } = this.roots.resolve(ref);
    const name = nameOfRel(rel);
    const kind = kindOf(name);
    if (!kind) throw new HttpError(400, `Unsupported file type: ${name}`);
    let st;
    try {
      st = await fs.stat(abs);
    } catch {
      throw new HttpError(404, `File not found: ${rel}`);
    }
    if (!st.isFile()) throw new HttpError(400, `Not a file: ${rel}`);
    const row = this.db
      .prepare('SELECT size, mtime_ms, meta, error FROM media_cache WHERE root = ? AND rel = ?')
      .get(root, rel) as { size: number; mtime_ms: number; meta: string; error: string | null } | undefined;
    let meta: MediaMeta;
    let metaError: string | undefined;
    if (row && row.size === st.size && row.mtime_ms === st.mtimeMs) {
      meta = JSON.parse(row.meta);
      metaError = row.error ?? undefined;
    } else {
      try {
        meta = await this.metadata.readMeta(abs, kind);
      } catch (e) {
        meta = {};
        metaError = (e as Error).message;
      }
      this.db
        .prepare(
          `INSERT INTO media_cache (root, rel, size, mtime_ms, meta, error) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(root, rel) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, meta = excluded.meta, error = excluded.error`,
        )
        .run(root, rel, st.size, st.mtimeMs, JSON.stringify(meta), metaError ?? null);
    }
    return { root, rel, name, kind, size: st.size, mtimeMs: st.mtimeMs, meta, metaError, gpsTz: tzForGps(meta.gps) };
  }

  /** Read many files; ExifTool's process pool bounds the real concurrency. */
  async getEntries(refs: FileRef[]): Promise<MediaEntry[]> {
    const out: MediaEntry[] = [];
    const CHUNK = 16;
    for (let i = 0; i < refs.length; i += CHUNK) {
      const part = await Promise.all(refs.slice(i, i + CHUNK).map((r) => this.getEntry(r).catch(() => null)));
      for (const e of part) if (e) out.push(e);
    }
    return out;
  }

  enrich(e: MediaEntry): EnrichedEntry {
    const settings = this.settings.get();
    const resolved = resolveDate(e, settings.dateSources, this.defaultTz);
    const folder = nameOfRel(dirOfRel(e.rel));
    return { ...e, resolved, issues: computeIssues({ entry: e, resolved, settings, folder }) };
  }

  invalidate(ref: FileRef): void {
    this.db.prepare('DELETE FROM media_cache WHERE root = ? AND rel = ?').run(ref.root, ref.rel);
  }

  /** Drop cache rows for a folder subtree (after moving or trashing a folder). */
  invalidatePrefix(root: string, relPrefix: string): void {
    this.db.prepare("DELETE FROM media_cache WHERE root = ? AND (rel = ? OR rel LIKE ? ESCAPE '\\')").run(
      root,
      relPrefix,
      `${relPrefix.replace(/[\\%_]/g, '\\$&')}/%`,
    );
  }
}
