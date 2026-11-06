import {
  DUPE_THRESHOLDS,
  defaultThreshold,
  kindOf,
  rankKeeper,
  type DupeGroup,
  type DupeScan,
  type DupeScanRequestSchema,
  type EnrichedEntry,
} from '@io/shared';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import type { z } from 'zod';
import { listDir, walkFiles } from '../fs/ops.js';
import { joinRel, type Roots } from '../fs/roots.js';
import { HttpError } from '../http/errors.js';
import type { Indexer } from '../index/indexer.js';
import { Limit, type Thumbs } from '../thumbs/thumbs.js';
import type { ClipModel } from './clip.js';
import { cosine, groupByKey, groupBySimilarity, type IndexGroup } from './group.js';
import { dhash, dhashWords, hamming, sha256File, type HashStore } from './hashes.js';

/** Above this many photos, near/similar grouping (O(n²)) gets slow: suggest a narrower folder. */
const LARGE_SCAN = 5000;

interface ScanState {
  info: DupeScan;
  /** Compared files, sorted by capture date so groups (and their seeds) run chronologically. */
  entries: EnrichedEntry[];
  sha: (string | null)[];
  dh: ([number, number] | null)[];
  vec: (Float32Array | null)[];
  /** Files that disappeared since the scan (trashed, moved); hidden until they come back. */
  gone: Set<string>;
  groups: DupeGroup[];
  abort: AbortController;
}

/**
 * Finds duplicate and similar files in a folder. Read-only, so it runs beside the job engine (not as
 * a step); resolving groups goes through a normal `trash` job. One scan at a time; the last result is
 * kept in memory and regrouped on threshold changes without rehashing. Progress events: 'scan'.
 */
export class DupeScanner extends EventEmitter {
  private cur: ScanState | null = null;
  private limit = new Limit(4);
  private lastEmit = 0;

  constructor(
    private roots: Roots,
    private indexer: Indexer,
    private thumbs: Thumbs,
    private hashes: HashStore,
    private clip: ClipModel,
  ) {
    super();
  }

  start(req: z.output<typeof DupeScanRequestSchema>): DupeScan {
    if (this.cur?.info.status === 'running') throw new HttpError(409, 'A scan is already running.');
    if (req.mode === 'similar' && !this.clip.enabled) throw new HttpError(400, 'Similar-scene search is disabled in the config (similar.enabled).');
    const dir = this.roots.resolve(req.folder);
    if (dir.root === 'trash') throw new HttpError(400, "The trash can't be scanned.");
    const s: ScanState = {
      info: {
        id: randomUUID(),
        status: 'running',
        folder: { root: dir.root, rel: dir.rel },
        recursive: req.recursive,
        mode: req.mode,
        threshold: clampThreshold(req.mode, req.threshold),
        phase: 'listing',
        done: 0,
        total: 0,
        fileCount: 0,
        startedAt: Date.now(),
        finishedAt: null,
      },
      entries: [],
      sha: [],
      dh: [],
      vec: [],
      gone: new Set(),
      groups: [],
      abort: new AbortController(),
    };
    this.cur = s;
    void this.run(s, dir.abs).then(
      () => this.finish(s, 'done'),
      (e) => this.finish(s, s.abort.signal.aborted ? 'cancelled' : 'failed', (e as Error).message),
    );
    return { ...s.info };
  }

  cancel(): DupeScan | null {
    this.cur?.abort.abort();
    return this.cur ? { ...this.cur.info } : null;
  }

  /** The latest scan with its groups, regrouped for `threshold` and without files that are gone. */
  async result(threshold?: number): Promise<DupeScan | null> {
    const s = this.cur;
    if (!s) return null;
    if (s.info.status !== 'done') return { ...s.info, groups: [] };
    let dirty = false;
    if (threshold !== undefined && s.info.mode !== 'exact') {
      const t = clampThreshold(s.info.mode, threshold);
      dirty = t !== s.info.threshold;
      s.info.threshold = t;
    }
    // Trashed or moved since the scan (and back again after an undo).
    const check = new Set([...s.gone, ...s.groups.flatMap((g) => g.files.map((f) => f.rel))]);
    await Promise.all(
      [...check].map(async (rel) => {
        const ok = await fs.access(this.roots.resolve({ root: s.info.folder.root, rel }).abs).then(
          () => true,
          () => false,
        );
        if (ok === s.gone.has(rel)) {
          dirty = true;
          if (ok) s.gone.delete(rel);
          else s.gone.add(rel);
        }
      }),
    );
    if (dirty) this.regroup(s);
    return { ...s.info, groups: s.groups };
  }

  private async run(s: ScanState, abs: string): Promise<void> {
    const { info, abort } = s;
    const signal = abort.signal;
    const { root, rel } = info.folder;
    const photosOnly = info.mode !== 'exact';

    const rels = info.recursive ? await walkFiles(abs, rel) : (await listDir(abs)).files.map((f) => joinRel(rel, f.name));
    const wanted = rels.filter((r) => (photosOnly ? kindOf(r) === 'photo' : kindOf(r) !== null));

    this.progress(s, 'reading', 0, wanted.length);
    const entries: EnrichedEntry[] = [];
    const CHUNK = 64;
    for (let i = 0; i < wanted.length; i += CHUNK) {
      signal.throwIfAborted();
      const part = await this.indexer.getEntries(wanted.slice(i, i + CHUNK).map((r) => ({ root, rel: r })));
      entries.push(...part.map((e) => this.indexer.enrich(e)));
      this.progress(s, 'reading', Math.min(i + CHUNK, wanted.length), wanted.length);
    }
    entries.sort((a, b) => (a.resolved?.utcMs ?? a.mtimeMs) - (b.resolved?.utcMs ?? b.mtimeMs) || a.rel.localeCompare(b.rel));
    s.entries = entries;
    info.fileCount = entries.length;
    if (photosOnly && entries.length > LARGE_SCAN) {
      info.note = `${entries.length} photos: grouping compares every pair, so it may take a while. A narrower folder is faster.`;
    }

    // Exact: only files that share their size with another file can be byte-identical.
    let targets = entries.map((_, i) => i);
    if (info.mode === 'exact') {
      const sizes = new Map<number, number>();
      for (const e of entries) sizes.set(e.size, (sizes.get(e.size) ?? 0) + 1);
      targets = targets.filter((i) => sizes.get(entries[i].size)! > 1);
    }
    if (info.mode === 'similar') {
      this.progress(s, 'model', 0, targets.length, true);
      await this.clip.load();
    }

    s.sha = new Array(entries.length).fill(null);
    s.dh = new Array(entries.length).fill(null);
    s.vec = new Array(entries.length).fill(null);
    let done = 0;
    this.progress(s, 'hashing', 0, targets.length, true);
    await Promise.all(
      targets.map((i) =>
        this.limit.run(async () => {
          if (signal.aborted) return;
          try {
            await this.hashOne(s, i, signal);
          } catch {
            /* unreadable file: left out of the comparison */
          }
          this.progress(s, 'hashing', ++done, targets.length);
        }),
      ),
    );
    signal.throwIfAborted();

    this.progress(s, 'grouping', 0, 0, true);
    this.regroup(s);
  }

  private async hashOne(s: ScanState, i: number, signal: AbortSignal): Promise<void> {
    const e = s.entries[i];
    const ref = { root: e.root, rel: e.rel };
    if (s.info.mode === 'exact') {
      let v = this.hashes.get(ref, e, 'sha256') as string | null;
      if (!v) {
        v = await sha256File(this.roots.resolve(ref).abs, signal);
        this.hashes.set(ref, e, 'sha256', v);
      }
      s.sha[i] = v;
    } else if (s.info.mode === 'near') {
      let v = this.hashes.get(ref, e, 'dhash') as string | null;
      if (!v) {
        v = await dhash(await this.thumbs.get(ref, 320));
        this.hashes.set(ref, e, 'dhash', v);
      }
      s.dh[i] = dhashWords(v);
    } else {
      const buf = this.hashes.get(ref, e, 'clip') as Buffer | null;
      let v: Float32Array;
      if (buf) {
        v = new Float32Array(new Uint8Array(buf).buffer);
      } else {
        v = await this.clip.embed(await this.thumbs.get(ref, 320));
        this.hashes.set(ref, e, 'clip', Buffer.from(v.buffer, v.byteOffset, v.byteLength));
      }
      s.vec[i] = v;
    }
  }

  private regroup(s: ScanState): void {
    const { mode, threshold } = s.info;
    const idx = s.entries.map((_, i) => i).filter((i) => !s.gone.has(s.entries[i].rel));
    let groups: IndexGroup[];
    if (mode === 'exact') {
      groups = groupByKey(idx.map((i) => s.sha[i]));
    } else if (mode === 'near') {
      const h = idx.map((i) => s.dh[i]);
      groups = groupBySimilarity(idx.length, (a, b) => (h[a] && h[b] ? 1 - hamming(h[a], h[b]) / 64 : 0), 1 - threshold / 64);
    } else {
      const v = idx.map((i) => s.vec[i]);
      groups = groupBySimilarity(idx.length, (a, b) => (v[a] && v[b] ? cosine(v[a], v[b]) : 0), threshold);
    }
    s.groups = groups.map((g) => {
      const files = g.members.map((m) => s.entries[idx[m]]);
      return { files, keep: rankKeeper(files), similarity: g.similarity };
    });
  }

  private progress(s: ScanState, phase: DupeScan['phase'], done: number, total: number, force = false): void {
    Object.assign(s.info, { phase, done, total });
    const now = Date.now();
    if (force || now - this.lastEmit >= 250) {
      this.lastEmit = now;
      this.emit('scan', { ...s.info });
    }
  }

  private finish(s: ScanState, status: DupeScan['status'], error?: string): void {
    Object.assign(s.info, { status, finishedAt: Date.now(), error: status === 'failed' ? error : undefined });
    this.emit('scan', { ...s.info });
  }
}

function clampThreshold(mode: DupeScan['mode'], t: number | undefined): number {
  if (mode === 'exact') return 0;
  const r = DUPE_THRESHOLDS[mode];
  return t === undefined ? defaultThreshold(mode) : Math.min(r.max, Math.max(r.min, t));
}
