import { z } from 'zod';
import { FileRefSchema } from './api.js';

const octal = z.string().regex(/^[0-7]{3,4}$/, 'must be an octal mode like 755');
const id = z.number().int().min(0).max(2 ** 31 - 1);

/**
 * Operations on a whole folder (Folders pane context menu). Each runs as a job with a dry run and,
 * except `delete`, undo. `move`/`copy` take the destination's parent folder (any root but the trash).
 */
export const FolderOpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rename'), name: z.string().min(1).max(200) }),
  z.object({ type: z.literal('move'), dest: FileRefSchema }),
  z.object({ type: z.literal('copy'), dest: FileRefSchema }),
  z.object({ type: z.literal('trash') }),
  /** Permanent: not undoable. */
  z.object({ type: z.literal('delete') }),
  /** Modes for the folder and subfolders (`dirMode`) and for files (`fileMode`); either can be left out. */
  z.object({ type: z.literal('chmod'), dirMode: octal.optional(), fileMode: octal.optional(), recursive: z.boolean().default(true) }),
  z.object({ type: z.literal('chown'), uid: id.optional(), gid: id.optional(), recursive: z.boolean().default(true) }),
]);
export type FolderOp = z.infer<typeof FolderOpSchema>;

export const FolderJobRequestSchema = z.object({ folder: FileRefSchema, op: FolderOpSchema });
export type FolderJobRequest = z.input<typeof FolderJobRequestSchema>;

export const FOLDER_OP_LABEL: Record<FolderOp['type'], string> = {
  rename: 'Rename folder',
  move: 'Move folder',
  copy: 'Copy folder',
  trash: 'Move folder to trash',
  delete: 'Delete folder permanently',
  chmod: 'Change permissions',
  chown: 'Change owner',
};

/** 0o755 → "rwxr-xr-x" (ignores setuid/setgid/sticky). */
export function modeString(mode: number): string {
  const rwx = (n: number) => `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
  return rwx((mode >> 6) & 7) + rwx((mode >> 3) & 7) + rwx(mode & 7);
}

/** A name for a new folder: no slashes, not hidden, not "." or "..". */
export const isValidFolderName = (name: string) => !!name.trim() && !/[/\\]|^\./.test(name.trim());
