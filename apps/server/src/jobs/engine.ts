import {
  FOLDER_OP_LABEL,
  STEP_INFO,
  isConvertJob,
  type FileRef,
  type FolderJobRequestSchema,
  type JobInfo,
  type JobRequest,
  type JobStatus,
  type PlanResult,
} from '@io/shared';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DB } from '../db/db.js';
import { encodeHevc, hasX265 } from '../convert/ffmpeg.js';
import { copyTree, moveFile, setFileTimes } from '../fs/ops.js';
import type { Roots } from '../fs/roots.js';
import { HttpError } from '../http/errors.js';
import type { Indexer } from '../index/indexer.js';
import type { Metadata, TagMap } from '../metadata/exiftool.js';
import type { SettingsStore } from '../settings/store.js';
import type { Trash } from '../trash/trash.js';
import type { z } from 'zod';
import { planFolderJob } from './folders.js';
import { expandSelection, planJob, type Op, type Plan } from './planner.js';

/** How to reverse one executed operation. Applied in reverse order by undo(). */
type UndoEntry =
  | { t: 'tags'; file: FileRef; values: TagMap }
  | { t: 'move'; from: FileRef; to: FileRef }
  | { t: 'utimes'; file: FileRef; atimeMs: number; mtimeMs: number }
  | { t: 'trash'; id: number }
  /** A converted video replaced `file`; the original is trash item `trashId`. */
  | { t: 'replace'; file: FileRef; trashId: number }
  /** `file` is a copy made by the job: undo moves it to the trash. */
  | { t: 'copy'; file: FileRef }
  | { t: 'chmod'; file: FileRef; mode: number }
  | { t: 'chown'; file: FileRef; uid: number; gid: number };

type Lane = JobInfo['lane'];
type Note = { file?: string; message: string };

/** Per-run state handed to runOp. */
interface Run {
  lane: Lane;
  signal: AbortSignal;
  notes: Note[];
  saved: { bytes: number };
  onProgress: (file: FileRef, pct: number) => void;
}

interface JobRow {
  id: string;
  title: string;
  status: JobStatus;
  request: string;
  total: number;
  done: number;
  errors: string;
  undo: string | null;
  rule_id: string | null;
  lane: Lane;
  notes: string;
  saved_bytes: number;
  created_at: number;
  finished_at: number | null;
}

/** Finished jobs (also cancelled ones, for the files they did change) can be undone. */
const canUndo = (r: JobRow) => (r.status === 'done' || r.status === 'cancelled') && !!r.undo && r.undo !== '[]';

const toInfo = (r: JobRow, current: JobInfo['current']): JobInfo => ({
  id: r.id,
  title: r.title,
  status: r.status,
  total: r.total,
  done: r.done,
  errors: JSON.parse(r.errors),
  notes: JSON.parse(r.notes),
  createdAt: r.created_at,
  finishedAt: r.finished_at,
  undoable: canUndo(r),
  ruleId: r.rule_id,
  lane: r.lane,
  current: current ?? null,
  savedBytes: r.saved_bytes,
});

const refText = (f: FileRef) => `${f.root}/${f.rel}`;

/**
 * Runs every mutation. Jobs execute one at a time on the main lane (a single promise chain), so two
 * batches never touch the same files concurrently. Video conversions get their own lane so a long
 * encode doesn't hold up everything else: encoding only reads the original, and every file change a
 * convert-lane job makes (the final swap, its other steps) runs on the main lane via exclusive().
 * Progress is emitted as 'job' events (SSE).
 */
export class JobEngine extends EventEmitter {
  private chain: Promise<unknown> = Promise.resolve();
  private convertChain: Promise<unknown> = Promise.resolve();
  private running = new Map<string, AbortController>();
  private current = new Map<string, NonNullable<JobInfo['current']>>();

  constructor(
    private db: DB,
    private roots: Roots,
    private indexer: Indexer,
    private metadata: Metadata,
    private trash: Trash,
    private settings: SettingsStore,
    private defaultTz: string,
  ) {
    super();
    // Jobs interrupted by a restart can't resume safely; mark them failed.
    db.prepare("UPDATE jobs SET status = 'failed', finished_at = ? WHERE status IN ('queued', 'running')").run(Date.now());
    // Partial encodes left by a restart.
    for (const { path: p } of db.prepare('SELECT path FROM convert_tmp').all() as { path: string }[]) fsSync.rmSync(p, { force: true });
    db.prepare('DELETE FROM convert_tmp').run();
  }

  async plan(req: JobRequest): Promise<Plan> {
    const refs = await expandSelection(req.selection, this.roots);
    const convertAvailable = isConvertJob(req.steps) ? await hasX265() : undefined;
    return planJob(refs, req.steps, { roots: this.roots, indexer: this.indexer, settings: this.settings.get(), defaultTz: this.defaultTz, convertAvailable });
  }

  static toResult(p: Plan): PlanResult {
    return { items: p.items, warnings: p.warnings, fileCount: p.fileCount };
  }

  /** Plan now (so validation errors surface to the caller), then queue execution. */
  async submit(req: JobRequest, ruleId?: string | null): Promise<JobInfo>;
  async submit(req: JobRequest, ruleId: string | null, opts: { skipIfEmpty: true }): Promise<JobInfo | null>;
  async submit(req: JobRequest, ruleId: string | null = null, opts: { skipIfEmpty?: boolean } = {}): Promise<JobInfo | null> {
    const plan = await this.plan(req);
    if (opts.skipIfEmpty && plan.ops.length === 0) return null;
    const title = req.title ?? req.steps.map((s) => STEP_INFO[s.type].label).join(' → ');
    return this.queue(title, req, plan, isConvertJob(req.steps) ? 'convert' : 'main', ruleId);
  }

  /** Dry run of a folder operation (rename, move, copy, trash, delete, chmod, chown). */
  planFolder(req: z.output<typeof FolderJobRequestSchema>): Promise<Plan> {
    return planFolderJob(req, this.roots);
  }

  async submitFolder(req: z.output<typeof FolderJobRequestSchema>): Promise<JobInfo> {
    const plan = await this.planFolder(req);
    const name = req.folder.rel.split('/').pop() || req.folder.root;
    return this.queue(`${FOLDER_OP_LABEL[req.op.type]}: ${name}`, req, plan, 'main', null);
  }

  private queue(title: string, req: unknown, plan: Plan, lane: Lane, ruleId: string | null): JobInfo {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO jobs (id, title, status, request, total, rule_id, lane, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, title, 'queued', JSON.stringify(req), plan.ops.length, ruleId, lane, Date.now());
    const planErrors = plan.items.filter((i) => i.error).map((i) => ({ file: refText(i.file), message: i.error! }));
    this.enqueue(() => this.execute(id, plan.ops, planErrors, lane), lane);
    // Announce it now: behind another job on its lane, it would otherwise stay invisible until it starts.
    const job = this.get(id);
    this.emit('job', job);
    return job;
  }

  /** Run arbitrary work in the job queue (trash restore/purge). */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private enqueue(fn: () => Promise<void>, lane: Lane = 'main') {
    if (lane === 'convert') this.convertChain = this.convertChain.then(fn).catch((e) => console.error('job failed', e));
    else this.chain = this.chain.then(fn).catch((e) => console.error('job failed', e));
  }

  /** File changes of a convert-lane job go through the main lane; main-lane jobs are already on it. */
  private onMain<T>(lane: Lane, fn: () => Promise<T>): Promise<T> {
    return lane === 'convert' ? this.exclusive(fn) : fn();
  }

  get(id: string): JobInfo {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    if (!row) throw new HttpError(404, 'Job not found');
    return toInfo(row, this.current.get(id));
  }

  list(limit = 50): JobInfo[] {
    return (this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit) as JobRow[]).map((r) =>
      toInfo(r, this.current.get(r.id)),
    );
  }

  /** Stop a queued or running job. Finished ops keep their undo entries; a running encode is killed. */
  cancel(id: string): JobInfo {
    const job = this.get(id);
    if (job.status === 'queued') this.update(id, { status: 'cancelled', finished_at: Date.now() });
    else if (job.status === 'running' && this.running.has(id)) this.running.get(id)!.abort();
    else throw new HttpError(409, 'This job is not running');
    return this.get(id);
  }

  undo(id: string): JobInfo {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    if (!row) throw new HttpError(404, 'Job not found');
    if (!canUndo(row)) throw new HttpError(409, 'This job cannot be undone');
    const entries = JSON.parse(row.undo!) as UndoEntry[];
    const undoId = randomUUID();
    this.db
      .prepare('INSERT INTO jobs (id, title, status, request, total, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(undoId, `Undo: ${row.title}`, 'queued', JSON.stringify({ undo: id }), entries.length, Date.now());
    this.db.prepare("UPDATE jobs SET status = 'undone' WHERE id = ?").run(id);
    this.emit('job', this.get(id));
    this.enqueue(() => this.runUndo(undoId, entries.reverse()));
    return this.get(undoId);
  }

  private update(id: string, fields: Partial<Pick<JobRow, 'status' | 'done' | 'errors' | 'notes' | 'saved_bytes' | 'undo' | 'finished_at'>>) {
    const keys = Object.keys(fields);
    this.db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => (fields as Record<string, unknown>)[k]), id);
    this.emit('job', this.get(id));
  }

  private async execute(id: string, ops: Op[], errors: Note[], lane: Lane): Promise<void> {
    if (this.get(id).status === 'cancelled') return;
    const undo: UndoEntry[] = [];
    const ac = new AbortController();
    this.running.set(id, ac);
    let done = 0;
    let lastEmit = 0;
    this.update(id, { status: 'running' });
    const run: Run = { lane, signal: ac.signal, notes: [], saved: { bytes: 0 }, onProgress: () => undefined };
    const progress = (force = false) => {
      if (force || Date.now() - lastEmit > 250) {
        lastEmit = Date.now();
        this.update(id, { done, errors: JSON.stringify(errors), notes: JSON.stringify(run.notes), saved_bytes: run.saved.bytes });
      }
    };
    run.onProgress = (file, pct) => {
      this.current.set(id, { file: refText(file), pct: Math.round(pct) });
      progress();
    };
    for (let i = 0; i < ops.length; ) {
      if (ac.signal.aborted) break;
      const op = ops[i];
      if (op.op === 'rename') {
        // All renames of one step run together in two phases (temp names first) so swaps never collide.
        let j = i;
        while (j < ops.length && ops[j].op === 'rename' && ops[j].step === op.step) j++;
        const batch = ops.slice(i, j) as Extract<Op, { op: 'rename' }>[];
        await this.onMain(lane, () => this.renameBatch(batch, undo, errors));
        done += batch.length;
        i = j;
      } else {
        try {
          if (op.op === 'convert') await this.convert(op, undo, run);
          else await this.onMain(lane, () => this.runOp(op, undo, run.notes));
        } catch (e) {
          if (!ac.signal.aborted) errors.push({ file: refText(op.file), message: (e as Error).message });
        }
        this.current.delete(id);
        if (!ac.signal.aborted) done++;
        i++;
      }
      progress();
    }
    this.running.delete(id);
    this.current.delete(id);
    progress(true);
    this.update(id, {
      status: ac.signal.aborted ? 'cancelled' : errors.length && errors.length >= ops.length && ops.length > 0 ? 'failed' : 'done',
      undo: JSON.stringify(undo),
      finished_at: Date.now(),
    });
  }

  /**
   * Encode next to the original (same device, so the swap is a rename) while other jobs keep running,
   * then swap on the main lane: copy all tags and the mtime over, trash the original, move the result in.
   */
  private async convert(op: Extract<Op, { op: 'convert' }>, undo: UndoEntry[], run: Run): Promise<void> {
    const file = this.roots.resolve(op.file);
    const before = await fs.stat(file.abs);
    const ext = path.extname(file.abs);
    const tmp = path.join(path.dirname(file.abs), `.io-convert-${randomUUID()}${ext}`);
    this.db.prepare('INSERT INTO convert_tmp (path) VALUES (?)').run(tmp);
    try {
      run.onProgress(op.file, 0);
      await encodeHevc(file.abs, tmp, {
        crf: op.crf,
        preset: op.preset,
        format: ext.toLowerCase() === '.mov' ? 'mov' : 'mp4',
        duration: op.duration,
        signal: run.signal,
        onProgress: (pct) => run.onProgress(op.file, pct),
      });
      const after = await fs.stat(tmp);
      const pct = Math.round((1 - after.size / before.size) * 100);
      if (pct < op.minSavingPct) {
        run.notes.push({ file: refText(op.file), message: `Kept the original: the HEVC version was only ${pct}% smaller` });
        return;
      }
      await this.exclusive(async () => {
        const now = await fs.stat(file.abs);
        if (now.size !== before.size || now.mtimeMs !== before.mtimeMs) throw new Error('The file changed while it was being converted; kept the original');
        await this.metadata.copyAllFrom(file.abs, tmp);
        await fs.utimes(tmp, before.atime, before.mtime);
        const item = await this.trash.trash(op.file);
        try {
          await moveFile(tmp, file.abs);
        } catch (e) {
          await this.trash.restore(item.id);
          throw e;
        }
        undo.push({ t: 'replace', file: op.file, trashId: item.id });
        this.indexer.invalidate(op.file);
      });
      run.saved.bytes += before.size - after.size;
    } finally {
      await fs.rm(tmp, { force: true });
      this.db.prepare('DELETE FROM convert_tmp WHERE path = ?').run(tmp);
    }
  }

  private async runOp(op: Exclude<Op, { op: 'rename' | 'convert' }>, undo: UndoEntry[], notes: Note[]): Promise<void> {
    const file = this.roots.resolve(op.file);
    const note = (r: { repaired?: string }) => r.repaired && notes.push({ file: refText(op.file), message: r.repaired });
    switch (op.op) {
      case 'writeTags': {
        const values = await this.metadata.snapshot(file.abs, op.snapshot);
        note(await this.metadata.write(file.abs, op.tags, { numeric: op.numeric }));
        undo.push({ t: 'tags', file: op.file, values });
        this.indexer.invalidate(op.file);
        return;
      }
      case 'copyTags': {
        const values = await this.metadata.snapshot(file.abs, op.tags);
        note(await this.metadata.copyFrom(this.roots.resolve(op.source).abs, file.abs, op.tags));
        undo.push({ t: 'tags', file: op.file, values });
        this.indexer.invalidate(op.file);
        return;
      }
      case 'move': {
        await moveFile(file.abs, this.roots.resolve(op.to).abs);
        undo.push({ t: 'move', from: op.to, to: op.file });
        this.indexer.invalidatePrefix(op.file.root, op.file.rel);
        return;
      }
      case 'copy': {
        await copyTree(file.abs, this.roots.resolve(op.to).abs);
        undo.push({ t: 'copy', file: op.to });
        return;
      }
      case 'delete': {
        await fs.rm(file.abs, { recursive: true });
        notes.push({ file: refText(op.file), message: 'Deleted permanently (not undoable)' });
        this.indexer.invalidatePrefix(op.file.root, op.file.rel);
        return;
      }
      case 'chmod': {
        const st = await fs.lstat(file.abs);
        await fs.chmod(file.abs, op.mode);
        undo.push({ t: 'chmod', file: op.file, mode: st.mode & 0o7777 });
        return;
      }
      case 'chown': {
        const st = await fs.lstat(file.abs);
        await fs.lchown(file.abs, op.uid, op.gid);
        undo.push({ t: 'chown', file: op.file, uid: st.uid, gid: st.gid });
        return;
      }
      case 'utimes': {
        const st = await fs.stat(file.abs);
        if (await setFileTimes(file.abs, new Date(op.mtimeMs), new Date(op.mtimeMs))) {
          notes.push({ file: refText(op.file), message: `Owned by another user (uid ${st.uid}); replaced with an identical copy owned by the app to set its date` });
        }
        undo.push({ t: 'utimes', file: op.file, atimeMs: st.atimeMs, mtimeMs: st.mtimeMs });
        return;
      }
      case 'trash': {
        const item = await this.trash.trash(op.file);
        undo.push({ t: 'trash', id: item.id });
        this.indexer.invalidatePrefix(op.file.root, op.file.rel);
        return;
      }
    }
  }

  private async renameBatch(batch: Extract<Op, { op: 'rename' }>[], undo: UndoEntry[], errors: Note[]) {
    const staged: { op: (typeof batch)[number]; tmp: string; src: string }[] = [];
    for (const op of batch) {
      try {
        const src = this.roots.resolve(op.file).abs;
        const tmp = path.join(path.dirname(src), `.io-tmp-${randomUUID()}`);
        await fs.rename(src, tmp);
        staged.push({ op, tmp, src });
      } catch (e) {
        errors.push({ file: refText(op.file), message: (e as Error).message });
      }
    }
    for (const { op, tmp, src } of staged) {
      try {
        await moveFile(tmp, this.roots.resolve(op.to).abs);
        undo.push({ t: 'move', from: op.to, to: op.file });
        this.indexer.invalidate(op.file);
      } catch (e) {
        errors.push({ file: refText(op.file), message: (e as Error).message });
        await fs.rename(tmp, src).catch(() => undefined);
      }
    }
  }

  private async runUndo(id: string, entries: UndoEntry[]): Promise<void> {
    const errors: Note[] = [];
    this.update(id, { status: 'running' });
    let done = 0;
    for (const u of entries) {
      try {
        switch (u.t) {
          case 'tags':
            await this.metadata.write(this.roots.resolve(u.file).abs, u.values);
            this.indexer.invalidate(u.file);
            break;
          case 'move':
            await moveFile(this.roots.resolve(u.from).abs, this.roots.resolve(u.to).abs);
            this.indexer.invalidatePrefix(u.from.root, u.from.rel);
            break;
          case 'copy':
            // Undoing a copy trashes it: undo never deletes anything.
            await this.trash.trash(u.file);
            this.indexer.invalidatePrefix(u.file.root, u.file.rel);
            break;
          case 'chmod':
            await fs.chmod(this.roots.resolve(u.file).abs, u.mode);
            break;
          case 'chown':
            await fs.lchown(this.roots.resolve(u.file).abs, u.uid, u.gid);
            break;
          case 'utimes':
            await setFileTimes(this.roots.resolve(u.file).abs, new Date(u.atimeMs), new Date(u.mtimeMs));
            break;
          case 'trash':
            await this.trash.restore(u.id);
            break;
          case 'replace':
            // The converted file goes to the trash too, so undo never deletes anything.
            await this.trash.trash(u.file);
            this.indexer.invalidate(u.file);
            await this.trash.restore(u.trashId);
            break;
        }
      } catch (e) {
        errors.push({ file: 'file' in u ? refText(u.file) : 'from' in u ? refText(u.from) : `trash #${u.id}`, message: (e as Error).message });
      }
      done++;
      this.update(id, { done, errors: JSON.stringify(errors) });
    }
    this.update(id, { status: errors.length === entries.length && entries.length > 0 ? 'failed' : 'done', finished_at: Date.now() });
  }
}
