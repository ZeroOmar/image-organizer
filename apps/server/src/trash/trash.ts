import type { FileRef, TrashItem } from '@io/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DB } from '../db/db.js';
import { moveFile, uniqueName } from '../fs/ops.js';
import { dirOfRel, joinRel, nameOfRel, type Roots } from '../fs/roots.js';
import { HttpError } from '../http/errors.js';

interface Row {
  id: number;
  origin_root: 'media' | 'import';
  original_rel: string;
  trash_rel: string;
  size: number;
  deleted_at: number;
}

const toItem = (r: Row): TrashItem => ({
  id: r.id,
  originRoot: r.origin_root,
  originalRel: r.original_rel,
  trashRel: r.trash_rel,
  size: r.size,
  deletedAt: r.deleted_at,
});

/**
 * Trash lives on its own mount (/trash). Files keep their origin and relative path:
 * /trash/media/<rel>, /trash/import/<rel>. A row per item makes restore exact.
 */
export class Trash {
  constructor(
    private db: DB,
    private roots: Roots,
  ) {}

  async trash(ref: FileRef): Promise<TrashItem> {
    if (ref.root === 'trash') throw new HttpError(400, 'Already in trash');
    const src = this.roots.resolve(ref);
    const st = await fs.stat(src.abs);
    const wantDir = joinRel(ref.root, dirOfRel(src.rel));
    const dstDir = this.roots.resolve({ root: 'trash', rel: wantDir });
    await fs.mkdir(dstDir.abs, { recursive: true });
    const name = await uniqueName(dstDir.abs, nameOfRel(src.rel));
    const trashRel = joinRel(wantDir, name);
    await moveFile(src.abs, path.join(dstDir.abs, name));
    const info = this.db
      .prepare('INSERT INTO trash_items (origin_root, original_rel, trash_rel, size, deleted_at) VALUES (?, ?, ?, ?, ?)')
      .run(ref.root, src.rel, trashRel, st.size, Date.now());
    return { id: Number(info.lastInsertRowid), originRoot: ref.root, originalRel: src.rel, trashRel, size: st.size, deletedAt: Date.now() };
  }

  /** Restore to the original path; if that name is taken now, use name_1.ext etc. Returns the restored ref. */
  async restore(id: number): Promise<FileRef> {
    const row = this.get(id);
    const src = this.roots.resolve({ root: 'trash', rel: row.trash_rel });
    const dstDir = this.roots.resolve({ root: row.origin_root, rel: dirOfRel(row.original_rel) });
    await fs.mkdir(dstDir.abs, { recursive: true });
    const name = await uniqueName(dstDir.abs, nameOfRel(row.original_rel));
    await moveFile(src.abs, path.join(dstDir.abs, name));
    this.db.prepare('DELETE FROM trash_items WHERE id = ?').run(id);
    return { root: row.origin_root, rel: joinRel(dstDir.rel, name) };
  }

  async purge(id: number): Promise<void> {
    const row = this.get(id);
    await fs.rm(this.roots.resolve({ root: 'trash', rel: row.trash_rel }).abs, { force: true });
    this.db.prepare('DELETE FROM trash_items WHERE id = ?').run(id);
  }

  async purgeOlderThan(days: number): Promise<number> {
    const cutoff = Date.now() - days * 86_400_000;
    const rows = this.db.prepare('SELECT id FROM trash_items WHERE deleted_at < ?').all(cutoff) as { id: number }[];
    for (const r of rows) await this.purge(r.id).catch(() => undefined);
    return rows.length;
  }

  list(): TrashItem[] {
    return (this.db.prepare('SELECT * FROM trash_items ORDER BY deleted_at DESC').all() as Row[]).map(toItem);
  }

  private get(id: number): Row {
    const row = this.db.prepare('SELECT * FROM trash_items WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new HttpError(404, `Trash item ${id} not found`);
    return row;
  }
}
