import { FOLDER_OP_LABEL, formatBytes, isValidFolderName, modeString, type FileRef, type FolderJobRequestSchema, type PlanItem } from '@io/shared';
import fs from 'node:fs/promises';
import type { z } from 'zod';
import { treeStats, uniqueName, walkAll } from '../fs/ops.js';
import { dirOfRel, joinRel, nameOfRel, type Roots } from '../fs/roots.js';
import { HttpError } from '../http/errors.js';
import type { Plan } from './planner.js';

type Req = z.output<typeof FolderJobRequestSchema>;

const show = (f: FileRef) => `${f.root}/${f.rel}`.replace(/\/$/, '');
const contents = (s: { files: number; dirs: number; bytes: number }) =>
  `${s.files} file${s.files === 1 ? '' : 's'}${s.dirs ? ` in ${s.dirs + 1} folders` : ''}, ${formatBytes(s.bytes)}`;

/**
 * Dry run of a folder operation. Move/copy/rename/trash/delete are one op on the folder itself;
 * chmod/chown are one op per entry that would change. Entries the app's user isn't allowed to change
 * (not root, not the owner) become error rows instead of ops.
 */
export async function planFolderJob(req: Req, roots: Roots): Promise<Plan> {
  const src = roots.resolve(req.folder);
  if (src.root === 'trash') throw new HttpError(400, 'Folders in the trash can only be restored or deleted from the Trash page');
  const st = await fs.stat(src.abs).catch(() => null);
  if (!st?.isDirectory()) throw new HttpError(404, `Folder not found: ${show(src)}`);
  const op = req.op;
  const folder: FileRef = { root: src.root, rel: src.rel };
  const plan: Plan = { ops: [], items: [], warnings: [], fileCount: 0 };
  const action = FOLDER_OP_LABEL[op.type];
  const item = (extra: Omit<PlanItem, 'file' | 'step' | 'action'>, file = folder) => plan.items.push({ file, step: 0, action, ...extra });
  const fail = (extra: Omit<PlanItem, 'file' | 'step' | 'action'>) => (item(extra), plan);

  if (op.type === 'chmod' || op.type === 'chown') {
    await planOwnership(op, folder, src.abs, plan, item);
    return plan;
  }

  if (!src.rel) throw new HttpError(400, `The ${src.root} root itself can't be renamed, moved, copied or deleted`);
  const stats = await treeStats(src.abs);
  plan.fileCount = stats.files;
  plan.warnings.push(`Contains ${contents(stats)}.`);
  const name = nameOfRel(src.rel);

  switch (op.type) {
    case 'rename': {
      const to = op.name.trim();
      if (!isValidFolderName(to)) throw new HttpError(400, 'Invalid folder name');
      if (to === name) return plan;
      const target: FileRef = { root: src.root, rel: joinRel(dirOfRel(src.rel), to) };
      const taken = await exists(roots.resolve(target).abs);
      // A case-only rename sees the folder itself as "taken" on case-insensitive filesystems.
      if (taken && to.toLowerCase() !== name.toLowerCase()) return fail({ before: name, error: `“${to}” already exists here` });
      plan.ops.push({ op: 'move', step: 0, file: folder, to: target });
      item({ before: name, after: to });
      return plan;
    }
    case 'move':
    case 'copy': {
      const dest = roots.resolve(op.dest);
      if (dest.root === 'trash') throw new HttpError(400, 'Use Move to trash to delete a folder');
      if (!(await fs.stat(dest.abs).catch(() => null))?.isDirectory()) throw new HttpError(404, `Folder not found: ${show(dest)}`);
      if (dest.root === src.root && (dest.rel === src.rel || dest.rel.startsWith(`${src.rel}/`))) {
        return fail({ before: show(src), error: `Can't ${op.type} a folder into itself` });
      }
      if (op.type === 'move') {
        if (dest.root === src.root && dest.rel === dirOfRel(src.rel)) return fail({ before: show(src), error: 'The folder is already there' });
        const target: FileRef = { root: dest.root, rel: joinRel(dest.rel, name) };
        if (await exists(roots.resolve(target).abs)) return fail({ before: show(src), error: `${show(target)} already exists` });
        plan.ops.push({ op: 'move', step: 0, file: folder, to: target });
        item({ before: show(src), after: show(target) });
      } else {
        // Copies never overwrite: a taken name becomes name_1, name_2 …
        const target: FileRef = { root: dest.root, rel: joinRel(dest.rel, await uniqueName(dest.abs, name)) };
        plan.ops.push({ op: 'copy', step: 0, file: folder, to: target });
        item({ before: show(src), after: show(target) });
      }
      return plan;
    }
    case 'trash':
      plan.ops.push({ op: 'trash', step: 0, file: folder });
      item({ before: show(src), after: 'Trash' });
      return plan;
    case 'delete':
      plan.ops.push({ op: 'delete', step: 0, file: folder });
      item({ before: show(src), after: 'Deleted permanently' });
      plan.warnings.push("This can't be undone: the folder skips the trash.");
      return plan;
  }
}

async function planOwnership(
  op: Extract<Req['op'], { type: 'chmod' | 'chown' }>,
  folder: FileRef,
  abs: string,
  plan: Plan,
  item: (extra: Omit<PlanItem, 'file' | 'step' | 'action'>, file?: FileRef) => void,
): Promise<void> {
  const self = await fs.lstat(abs);
  const entries = [{ rel: '', dir: true, mode: self.mode & 0o7777, uid: self.uid, gid: self.gid }];
  if (op.recursive) entries.push(...(await walkAll(abs)));
  const uid = process.getuid?.() ?? 0;
  const groups = new Set(process.getgroups?.() ?? []);
  const ref = (rel: string): FileRef => ({ root: folder.root, rel: rel ? joinRel(folder.rel, rel) : folder.rel });
  let denied = 0;

  for (const e of entries) {
    const file = ref(e.rel);
    if (op.type === 'chmod') {
      const want = e.dir ? op.dirMode : op.fileMode;
      if (want === undefined) continue;
      const mode = parseInt(want, 8);
      if (mode === e.mode) continue;
      plan.fileCount++;
      // Only the owner (or root) may chmod.
      if (uid !== 0 && e.uid !== uid) {
        denied++;
        item({ before: modeString(e.mode), error: `Owned by uid ${e.uid}; the app runs as uid ${uid}` }, file);
        continue;
      }
      plan.ops.push({ op: 'chmod', step: 0, file, mode });
      item({ before: modeString(e.mode), after: `${modeString(mode)} (${want.padStart(4, '0').slice(-3)})` }, file);
    } else {
      const toUid = op.uid ?? e.uid;
      const toGid = op.gid ?? e.gid;
      if (toUid === e.uid && toGid === e.gid) continue;
      plan.fileCount++;
      // Without root: only your own files, owner unchanged, and only to a group you belong to.
      const why =
        uid === 0
          ? null
          : e.uid !== uid
            ? `Owned by uid ${e.uid}; the app runs as uid ${uid}`
            : toUid !== e.uid
              ? `Only root can give files to another user (the app runs as uid ${uid})`
              : !groups.has(toGid)
                ? `The app's user isn't in group ${toGid}`
                : null;
      if (why) {
        denied++;
        item({ before: `${e.uid}:${e.gid}`, error: why }, file);
        continue;
      }
      plan.ops.push({ op: 'chown', step: 0, file, uid: toUid, gid: toGid });
      item({ before: `${e.uid}:${e.gid}`, after: `${toUid}:${toGid}` }, file);
    }
  }
  if (denied) {
    plan.warnings.push(
      `${denied} item${denied === 1 ? '' : 's'} can't be changed by the app's user (uid ${uid}) and will be skipped. ` +
        'Set PUID/PGID to the owner of the share, or run the container as root (PUID=0) to change owners.',
    );
  }
}

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );
