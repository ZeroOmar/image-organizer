import type { FileRef, RootName } from '@io/shared';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/schema.js';
import { HttpError } from '../http/errors.js';

export interface ResolvedPath {
  root: RootName;
  rel: string;
  abs: string;
}

/**
 * Every filesystem access goes through here. Paths are (root, rel) pairs; `rel` is
 * normalized, must stay inside the root, and symlinks must not lead outside it.
 */
export class Roots {
  readonly dirs: Record<RootName, string>;
  private real: Partial<Record<RootName, string>> = {};

  constructor(config: AppConfig) {
    this.dirs = {
      media: path.resolve(config.media.root),
      import: path.resolve(config.import.root),
      trash: path.resolve(config.trash.root),
    };
  }

  /** Create missing roots and check they're writable. Returns per-root device ids. */
  init(): Record<RootName, number> {
    const dev = {} as Record<RootName, number>;
    for (const [name, dir] of Object.entries(this.dirs) as [RootName, string][]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
      this.real[name] = fs.realpathSync(dir);
      dev[name] = fs.statSync(dir).dev;
    }
    return dev;
  }

  static normalizeRel(rel: string): string {
    const raw = String(rel ?? '').replace(/\\/g, '/');
    // Reject rather than clamp: "../x" is never a legitimate request.
    if (raw.split('/').some((p) => p === '..')) throw new HttpError(400, 'Invalid path');
    const clean = path.posix.normalize(`/${raw}`).slice(1);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000]/.test(clean)) throw new HttpError(400, 'Invalid path');
    return clean.replace(/\/+$/, '');
  }

  resolve(ref: FileRef): ResolvedPath {
    const root = ref.root;
    const base = this.dirs[root];
    if (!base) throw new HttpError(400, `Unknown root ${String(root)}`);
    const rel = Roots.normalizeRel(ref.rel);
    const abs = rel ? path.join(base, ...rel.split('/')) : base;
    if (abs !== base && !abs.startsWith(base + path.sep)) throw new HttpError(400, 'Path escapes root');
    this.assertNoSymlinkEscape(root, abs);
    return { root, rel, abs };
  }

  /** Walk up to the nearest existing ancestor and make sure its real path is inside the root. */
  private assertNoSymlinkEscape(root: RootName, abs: string): void {
    const realRoot = this.real[root] ?? (this.real[root] = fs.realpathSync(this.dirs[root]));
    let p = abs;
    for (;;) {
      try {
        const real = fs.realpathSync(p);
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new HttpError(403, 'Path escapes root');
        return;
      } catch (e) {
        if (e instanceof HttpError) throw e;
        const parent = path.dirname(p);
        if (parent === p) return;
        p = parent;
      }
    }
  }

  relOf(root: RootName, abs: string): string {
    return path.relative(this.dirs[root], abs).split(path.sep).join('/');
  }
}

export const joinRel = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
export const dirOfRel = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
export const nameOfRel = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);
