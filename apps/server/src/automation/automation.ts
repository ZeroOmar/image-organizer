import { RuleSchema, kindOf, type FileRef, type Rule } from '@io/shared';
import { watch, type FSWatcher } from 'chokidar';
import { Cron } from 'croner';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DB } from '../db/db.js';
import { isHidden } from '../fs/ops.js';
import type { Roots } from '../fs/roots.js';
import { HttpError } from '../http/errors.js';
import type { JobEngine } from '../jobs/engine.js';

interface Row {
  id: string;
  data: string;
  last_run_at: number | null;
  last_job_id: string | null;
}

/** New files must sit untouched this long before a watched rule picks them up. */
const WATCH_SETTLE_MS = 10_000;

/**
 * Saved rule pipelines. A rule = target folder + ordered steps, run on demand, on a cron
 * schedule (croner) and/or when files land in the target folder (chokidar).
 */
export class Automation {
  private crons = new Map<string, Cron>();
  private watchers = new Map<string, FSWatcher>();
  private pending = new Map<string, { files: Set<string>; timer: NodeJS.Timeout }>();

  constructor(
    private db: DB,
    private roots: Roots,
    private jobs: JobEngine,
  ) {}

  list(): Rule[] {
    return (this.db.prepare('SELECT * FROM rules ORDER BY rowid').all() as Row[]).map((r) => ({
      ...RuleSchema.parse(JSON.parse(r.data)),
      id: r.id,
      lastRunAt: r.last_run_at,
      lastJobId: r.last_job_id,
    }));
  }

  get(id: string): Rule {
    const rule = this.list().find((r) => r.id === id);
    if (!rule) throw new HttpError(404, 'Rule not found');
    return rule;
  }

  save(input: unknown, id?: string): Rule {
    const data = RuleSchema.parse(input);
    if (data.schedule) {
      try {
        new Cron(data.schedule, { paused: true }).stop();
      } catch (e) {
        throw new HttpError(400, `Invalid schedule: ${(e as Error).message}`);
      }
    }
    this.roots.resolve(data.target.folder);
    const ruleId = id ?? randomUUID();
    const { id: _ignored, ...rest } = data;
    if (id) {
      const res = this.db.prepare('UPDATE rules SET data = ? WHERE id = ?').run(JSON.stringify(rest), id);
      if (!res.changes) throw new HttpError(404, 'Rule not found');
    } else {
      this.db.prepare('INSERT INTO rules (id, data) VALUES (?, ?)').run(ruleId, JSON.stringify(rest));
    }
    this.arm(this.get(ruleId));
    return this.get(ruleId);
  }

  remove(id: string): void {
    this.disarm(id);
    this.db.prepare('DELETE FROM rules WHERE id = ?').run(id);
  }

  /** Manual runs always create a job; scheduled/watched runs skip when there is nothing to do. */
  async run(id: string, files?: FileRef[], automatic = false) {
    const rule = this.get(id);
    const req = {
      title: `Rule: ${rule.name}`,
      selection: files?.length ? { files } : { folder: rule.target.folder, recursive: rule.target.recursive },
      steps: rule.steps,
    };
    const job = automatic ? await this.jobs.submit(req, id, { skipIfEmpty: true }) : await this.jobs.submit(req, id);
    this.db.prepare('UPDATE rules SET last_run_at = ?, last_job_id = COALESCE(?, last_job_id) WHERE id = ?').run(Date.now(), job?.id ?? null, id);
    return job;
  }

  async dryRun(id: string) {
    const rule = this.get(id);
    return this.jobs.plan({ selection: { folder: rule.target.folder, recursive: rule.target.recursive }, steps: rule.steps });
  }

  start(): void {
    for (const r of this.list()) this.arm(r);
  }

  async stop(): Promise<void> {
    for (const id of [...this.crons.keys(), ...this.watchers.keys()]) this.disarm(id);
  }

  private arm(rule: Rule): void {
    this.disarm(rule.id);
    if (!rule.enabled) return;
    if (rule.schedule) {
      this.crons.set(
        rule.id,
        new Cron(rule.schedule, { protect: true }, () => {
          this.run(rule.id, undefined, true).catch((e) => console.error(`rule ${rule.name} failed`, e));
        }),
      );
    }
    if (rule.watch) {
      const dir = this.roots.resolve(rule.target.folder);
      const w = watch(dir.abs, {
        ignoreInitial: true,
        depth: rule.target.recursive ? undefined : 0,
        awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
        ignored: (p) => isHidden(path.basename(p)) && p !== dir.abs,
      });
      w.on('add', (abs) => {
        if (!kindOf(abs)) return;
        this.queueWatched(rule.id, dir.root, this.roots.relOf(dir.root, abs));
      });
      this.watchers.set(rule.id, w);
    }
  }

  private queueWatched(ruleId: string, root: FileRef['root'], rel: string) {
    let p = this.pending.get(ruleId);
    if (p) clearTimeout(p.timer);
    else this.pending.set(ruleId, (p = { files: new Set(), timer: undefined as unknown as NodeJS.Timeout }));
    p.files.add(rel);
    p.timer = setTimeout(() => {
      const files = [...p!.files].map((r) => ({ root, rel: r }));
      this.pending.delete(ruleId);
      this.run(ruleId, files, true).catch((e) => console.error('watched rule failed', e));
    }, WATCH_SETTLE_MS);
  }

  private disarm(id: string): void {
    this.crons.get(id)?.stop();
    this.crons.delete(id);
    void this.watchers.get(id)?.close();
    this.watchers.delete(id);
    const p = this.pending.get(id);
    if (p) clearTimeout(p.timer);
    this.pending.delete(id);
  }
}
