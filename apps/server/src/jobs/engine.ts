import { STEP_INFO, type FileRef, type JobInfo, type JobRequest, type JobStatus, type PlanResult } from '@io/shared';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DB } from '../db/db.js';
import { moveFile } from '../fs/ops.js';
import type { Roots } from '../fs/roots.js';
import { HttpError } from '../http/errors.js';
import type { Indexer } from '../index/indexer.js';
import type { Metadata, TagMap } from '../metadata/exiftool.js';
import type { SettingsStore } from '../settings/store.js';
import type { Trash } from '../trash/trash.js';
import { expandSelection, planJob, type Op, type Plan } from './planner.js';

/** How to reverse one executed operation. Applied in reverse order by undo(). */
type UndoEntry =
  | { t: 'tags'; file: FileRef; values: TagMap }
  | { t: 'move'; from: FileRef; to: FileRef }
  | { t: 'utimes'; file: FileRef; atimeMs: number; mtimeMs: number }
  | { t: 'trash'; id: number };

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
  created_at: number;
  finished_at: number | null;
}

const toInfo = (r: JobRow): JobInfo => ({
  id: r.id,
  title: r.title,
  status: r.status,
  total: r.total,
  done: r.done,
  errors: JSON.parse(r.errors),
  createdAt: r.created_at,
  finishedAt: r.finished_at,
  undoable: r.status === 'done' && !!r.undo && r.undo !== '[]',
  ruleId: r.rule_id,
});

const refText = (f: FileRef) => `${f.root}/${f.rel}`;

/**
 * Runs every mutation. Jobs execute one at a time (a single promise chain), so two batches
 * never touch the same files concurrently. Progress is emitted as 'job' events (SSE).
 */
export class JobEngine extends EventEmitter {
  private chain: Promise<unknown> = Promise.resolve();

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
  }

  async plan(req: JobRequest): Promise<Plan> {
    const refs = await expandSelection(req.selection, this.roots);
    return planJob(refs, req.steps, { roots: this.roots, indexer: this.indexer, settings: this.settings.get(), defaultTz: this.defaultTz });
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
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO jobs (id, title, status, request, total, rule_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, title, 'queued', JSON.stringify(req), plan.ops.length, ruleId, Date.now());
    const planErrors = plan.items.filter((i) => i.error).map((i) => ({ file: refText(i.file), message: i.error! }));
    this.enqueue(() => this.execute(id, plan.ops, planErrors));
    return this.get(id);
  }

  /** Run arbitrary work in the job queue (trash restore/purge). */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private enqueue(fn: () => Promise<void>) {
    this.chain = this.chain.then(fn).catch((e) => console.error('job failed', e));
  }

  get(id: string): JobInfo {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    if (!row) throw new HttpError(404, 'Job not found');
    return toInfo(row);
  }

  list(limit = 50): JobInfo[] {
    return (this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit) as JobRow[]).map(toInfo);
  }

  undo(id: string): JobInfo {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    if (!row) throw new HttpError(404, 'Job not found');
    if (row.status !== 'done' || !row.undo) throw new HttpError(409, 'This job cannot be undone');
    const entries = JSON.parse(row.undo) as UndoEntry[];
    const undoId = randomUUID();
    this.db
      .prepare('INSERT INTO jobs (id, title, status, request, total, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(undoId, `Undo: ${row.title}`, 'queued', JSON.stringify({ undo: id }), entries.length, Date.now());
    this.db.prepare("UPDATE jobs SET status = 'undone' WHERE id = ?").run(id);
    this.emit('job', this.get(id));
    this.enqueue(() => this.runUndo(undoId, entries.reverse()));
    return this.get(undoId);
  }

  private update(id: string, fields: Partial<Pick<JobRow, 'status' | 'done' | 'errors' | 'undo' | 'finished_at'>>) {
    const keys = Object.keys(fields);
    this.db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => (fields as Record<string, unknown>)[k]), id);
    this.emit('job', this.get(id));
  }

  private async execute(id: string, ops: Op[], errors: { file?: string; message: string }[]): Promise<void> {
    const undo: UndoEntry[] = [];
    let done = 0;
    let lastEmit = 0;
    this.update(id, { status: 'running' });
    const progress = (force = false) => {
      if (force || Date.now() - lastEmit > 250) {
        lastEmit = Date.now();
        this.update(id, { done, errors: JSON.stringify(errors) });
      }
    };
    for (let i = 0; i < ops.length; ) {
      const op = ops[i];
      if (op.op === 'rename') {
        // All renames of one step run together in two phases (temp names first) so swaps never collide.
        let j = i;
        while (j < ops.length && ops[j].op === 'rename' && ops[j].step === op.step) j++;
        const batch = ops.slice(i, j) as Extract<Op, { op: 'rename' }>[];
        await this.renameBatch(batch, undo, errors);
        done += batch.length;
        i = j;
      } else {
        try {
          await this.runOp(op, undo);
        } catch (e) {
          errors.push({ file: refText(op.file), message: (e as Error).message });
        }
        done++;
        i++;
      }
      progress();
    }
    progress(true);
    this.update(id, {
      status: errors.length && errors.length >= ops.length && ops.length > 0 ? 'failed' : 'done',
      undo: JSON.stringify(undo),
      finished_at: Date.now(),
    });
  }

  private async runOp(op: Exclude<Op, { op: 'rename' }>, undo: UndoEntry[]): Promise<void> {
    const file = this.roots.resolve(op.file);
    switch (op.op) {
      case 'writeTags': {
        const values = await this.metadata.snapshot(file.abs, op.snapshot);
        await this.metadata.write(file.abs, op.tags, { numeric: op.numeric });
        undo.push({ t: 'tags', file: op.file, values });
        this.indexer.invalidate(op.file);
        return;
      }
      case 'copyTags': {
        const values = await this.metadata.snapshot(file.abs, op.tags);
        await this.metadata.copyFrom(this.roots.resolve(op.source).abs, file.abs, op.tags);
        undo.push({ t: 'tags', file: op.file, values });
        this.indexer.invalidate(op.file);
        return;
      }
      case 'move': {
        await moveFile(file.abs, this.roots.resolve(op.to).abs);
        undo.push({ t: 'move', from: op.to, to: op.file });
        this.indexer.invalidate(op.file);
        return;
      }
      case 'utimes': {
        const st = await fs.stat(file.abs);
        await fs.utimes(file.abs, new Date(op.mtimeMs), new Date(op.mtimeMs));
        undo.push({ t: 'utimes', file: op.file, atimeMs: st.atimeMs, mtimeMs: st.mtimeMs });
        return;
      }
      case 'trash': {
        const item = await this.trash.trash(op.file);
        undo.push({ t: 'trash', id: item.id });
        this.indexer.invalidate(op.file);
        return;
      }
    }
  }

  private async renameBatch(batch: Extract<Op, { op: 'rename' }>[], undo: UndoEntry[], errors: { file?: string; message: string }[]) {
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
    const errors: { file?: string; message: string }[] = [];
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
            this.indexer.invalidate(u.from);
            break;
          case 'utimes':
            await fs.utimes(this.roots.resolve(u.file).abs, new Date(u.atimeMs), new Date(u.mtimeMs));
            break;
          case 'trash':
            await this.trash.restore(u.id);
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
