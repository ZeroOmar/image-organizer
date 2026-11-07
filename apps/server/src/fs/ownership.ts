import type { Settings } from '@io/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import { walkAll } from './ops.js';

type Policy = Settings['ownership'];
type Entry = { dir: boolean; mode: number; uid: number; gid: number };
/** Gets each path that couldn't be changed and why. Ownership never fails the write it follows. */
export type Warn = (abs: string, message: string) => void;

const logWarn: Warn = (abs, message) => console.warn(`ownership: ${abs}: ${message}`);

/**
 * Settings → Ownership: give every file and folder the app creates or changes a fixed owner and
 * mode, e.g. so files written while running as PUID 0 stay usable by the share's other users.
 * It's a policy on the result, so it isn't undone (undo results get it too). Only what differs
 * from the policy is changed, so a non-root app user can still apply modes to files it owns.
 */
export class Ownership {
  constructor(private policy: () => Policy) {}

  private active(): Policy | null {
    const p = this.policy();
    return p.enabled && (p.uid !== null || p.gid !== null || p.fileMode !== null || p.dirMode !== null) ? p : null;
  }

  /** Apply to `abs` and, for a folder, everything under it. */
  async apply(abs: string, warn: Warn = logWarn): Promise<void> {
    const p = this.active();
    if (!p) return;
    const st = await fs.lstat(abs).catch(() => null);
    if (!st || st.isSymbolicLink()) return;
    await this.fix(abs, { dir: st.isDirectory(), mode: st.mode & 0o7777, uid: st.uid, gid: st.gid }, p, warn);
    if (st.isDirectory()) for (const e of await walkAll(abs)) await this.fix(path.join(abs, e.rel), e, p, warn);
  }

  /** `mkdir -p dir`, applying the policy to the folders it creates. Existing folders are left alone. */
  async mkdirp(dir: string, warn: Warn = logWarn): Promise<void> {
    const p = this.active();
    const created = p ? await missingDirs(dir) : [];
    await fs.mkdir(dir, { recursive: true });
    for (const d of created) {
      const st = await fs.lstat(d);
      await this.fix(d, { dir: true, mode: st.mode & 0o7777, uid: st.uid, gid: st.gid }, p!, warn);
    }
  }

  /** Run `fn`, which creates or replaces `abs`, after creating its parent folders; then apply the policy to `abs`. */
  async wrote<T>(abs: string, fn: () => Promise<T>, warn: Warn = logWarn): Promise<T> {
    await this.mkdirp(path.dirname(abs), warn);
    const out = await fn();
    await this.apply(abs, warn);
    return out;
  }

  private async fix(abs: string, e: Entry, p: Policy, warn: Warn): Promise<void> {
    const mode = e.dir ? p.dirMode : p.fileMode;
    const uid = p.uid ?? e.uid;
    const gid = p.gid ?? e.gid;
    // Owner first (chown clears setuid/setgid bits). Each is tried on its own: without root the chown
    // may fail while the chmod of a file the app owns still works. One warning per path.
    let failed: string | null = null;
    if (uid !== e.uid || gid !== e.gid) await fs.lchown(abs, uid, gid).catch((err: Error) => (failed = err.message));
    if (mode !== null && parseInt(mode, 8) !== e.mode) await fs.chmod(abs, parseInt(mode, 8)).catch((err: Error) => (failed ??= err.message));
    if (failed) warn(abs, failed);
  }
}

/** The folders that `mkdir -p dir` would create, top-down. */
async function missingDirs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (let d = dir; ; d = path.dirname(d)) {
    if (await fs.lstat(d).then(() => true, () => false)) return out;
    out.unshift(d);
    if (path.dirname(d) === d) return out;
  }
}
