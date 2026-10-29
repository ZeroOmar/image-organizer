import { baseOf, kindOf, type TreeNode } from '@io/shared';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../http/errors.js';

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

/** Hidden entries (dot files, our temp files) never show in listings. */
export const isHidden = (name: string) => name.startsWith('.');

/**
 * Move a file without ever overwriting. Same device → rename(). Across devices (e.g. /media → /trash)
 * → copy to a temp name, verify size, fsync, rename into place, then unlink the source.
 */
export async function moveFile(src: string, dst: string): Promise<void> {
  if (src === dst) return;
  if (await exists(dst)) {
    // A case-only rename on a case-insensitive filesystem sees the source itself as "existing".
    const [a, b] = await Promise.all([fs.stat(src), fs.stat(dst)]);
    if (a.ino !== b.ino || a.dev !== b.dev) throw new HttpError(409, `Already exists: ${path.basename(dst)}`);
  }
  await fs.mkdir(path.dirname(dst), { recursive: true });
  try {
    await fs.rename(src, dst);
    return;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
  }
  const tmp = path.join(path.dirname(dst), `.io-tmp-${randomUUID()}`);
  try {
    await fs.copyFile(src, tmp, fs.constants.COPYFILE_EXCL);
    const [a, b] = await Promise.all([fs.stat(src), fs.stat(tmp)]);
    if (a.size !== b.size) throw new Error(`Copy size mismatch for ${path.basename(src)}`);
    await fs.utimes(tmp, a.atime, a.mtime);
    const fh = await fs.open(tmp, 'r');
    await fh.sync();
    await fh.close();
    await fs.rename(tmp, dst);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
  await fs.unlink(src);
}

/** "name.ext" → first free of name.ext, name_1.ext, name_2.ext … in `dir` (case-insensitive). */
export async function uniqueName(dir: string, name: string, sep = '_'): Promise<string> {
  const taken = new Set((await fs.readdir(dir).catch(() => [] as string[])).map((n) => n.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const base = baseOf(name);
  const ext = name.slice(base.length);
  for (let i = 1; ; i++) {
    const cand = `${base}${sep}${i}${ext}`;
    if (!taken.has(cand.toLowerCase())) return cand;
  }
}

export interface DirListing {
  dirs: string[];
  files: { name: string; size: number; mtimeMs: number }[];
  /** Every non-hidden name in the directory, lower-cased (for conflict checks). */
  allNames: Set<string>;
}

export async function listDir(abs: string): Promise<DirListing> {
  let entries;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Folder not found');
    throw e;
  }
  const dirs: string[] = [];
  const files: DirListing['files'] = [];
  const allNames = new Set<string>();
  for (const d of entries) {
    allNames.add(d.name.toLowerCase());
    if (isHidden(d.name)) continue;
    if (d.isDirectory()) dirs.push(d.name);
    else if (d.isFile() && kindOf(d.name)) {
      const st = await fs.stat(path.join(abs, d.name)).catch(() => null);
      if (st) files.push({ name: d.name, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  dirs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { dirs, files, allNames };
}

export async function treeChildren(abs: string, rel: string): Promise<TreeNode[]> {
  const { dirs } = await listDir(abs);
  return Promise.all(
    dirs.map(async (name) => {
      const sub = await fs.readdir(path.join(abs, name), { withFileTypes: true }).catch(() => []);
      return {
        name,
        rel: rel ? `${rel}/${name}` : name,
        hasChildren: sub.some((d) => d.isDirectory() && !isHidden(d.name)),
      };
    }),
  );
}

/** Recursively list media files under a folder (used for recursive selections and rules). */
export async function walkFiles(abs: string, rel: string): Promise<string[]> {
  const out: string[] = [];
  const { dirs, files } = await listDir(abs);
  for (const f of files) out.push(rel ? `${rel}/${f.name}` : f.name);
  for (const d of dirs) out.push(...(await walkFiles(path.join(abs, d), rel ? `${rel}/${d}` : d)));
  return out;
}
