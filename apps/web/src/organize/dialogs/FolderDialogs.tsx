import { FOLDER_OP_LABEL, isValidFolderName, modeString, type FileRef, type FolderOp, type RootName } from '@io/shared';
import { useState } from 'react';
import { applyFolderJob, planFolderJob } from '../../api/hooks';
import { ActionDialog } from '../../components/ActionDialog';
import { FolderPicker } from '../../components/FolderPicker';

export type FolderDialogKind = 'rename' | 'move' | 'copy' | 'trash' | 'chmod' | 'chown';

const MODE_PRESETS = [
  { label: 'Standard', dir: '755', file: '644' },
  { label: 'Group can write', dir: '775', file: '664' },
  { label: 'Owner only', dir: '700', file: '600' },
];
const OCTAL = /^[0-7]{3,4}$/;

/**
 * Folders pane menu actions. Each builds a FolderOp and runs it through ActionDialog (dry run →
 * job). `onApplied` gets the op and job so the Workspace can follow a renamed or moved folder.
 */
export function FolderDialog({
  kind,
  folder,
  permanent: initialPermanent = false,
  onClose,
  onApplied,
}: {
  kind: FolderDialogKind;
  folder: FileRef;
  /** Trash: start with "Delete permanently" ticked (Shift was held). */
  permanent?: boolean;
  onClose: () => void;
  onApplied?: (op: FolderOp, jobId: string) => void;
}) {
  const name = folder.rel.split('/').pop() || folder.root;
  const parent = folder.rel.includes('/') ? folder.rel.slice(0, folder.rel.lastIndexOf('/')) : '';
  const [newName, setNewName] = useState(name);
  const [destRoot, setDestRoot] = useState<RootName>(folder.root);
  const [dest, setDest] = useState(parent);
  const [permanent, setPermanent] = useState(initialPermanent);
  const [dirMode, setDirMode] = useState<string | null>('755');
  const [fileMode, setFileMode] = useState<string | null>('644');
  const [uid, setUid] = useState('');
  const [gid, setGid] = useState('');
  const [recursive, setRecursive] = useState(true);

  let op: FolderOp | null = null;
  let invalid: string | null = null;
  switch (kind) {
    case 'rename':
      op = { type: 'rename', name: newName.trim() };
      invalid = !isValidFolderName(newName) ? 'Enter a name without slashes that doesn’t start with a dot' : newName.trim() === name ? 'Enter a new name' : null;
      break;
    case 'move':
    case 'copy':
      op = { type: kind, dest: { root: destRoot, rel: dest } };
      invalid = kind === 'move' && destRoot === folder.root && dest === parent ? 'Choose a different folder' : null;
      break;
    case 'trash':
      op = { type: permanent ? 'delete' : 'trash' };
      break;
    case 'chmod':
      op = { type: 'chmod', dirMode: dirMode ?? undefined, fileMode: fileMode ?? undefined, recursive };
      invalid =
        dirMode === null && fileMode === null
          ? 'Choose folder or file permissions'
          : [dirMode, fileMode].some((m) => m !== null && !OCTAL.test(m))
            ? 'Permissions are 3 octal digits, e.g. 755'
            : null;
      break;
    case 'chown': {
      const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
      op = { type: 'chown', uid: num(uid), gid: num(gid), recursive };
      invalid =
        uid.trim() === '' && gid.trim() === ''
          ? 'Enter a user ID, a group ID or both'
          : [uid, gid].some((s) => s.trim() !== '' && !/^\d+$/.test(s.trim()))
            ? 'IDs are numbers, e.g. 1000'
            : null;
      break;
    }
  }

  const runner = op && { plan: () => planFolderJob({ folder, op: op! }), submit: () => applyFolderJob({ folder, op: op! }) };
  const title = op ? `${FOLDER_OP_LABEL[op.type]}: ${name}` : name;
  const applyLabel = { rename: 'Rename', move: 'Move', copy: 'Copy', trash: permanent ? 'Delete permanently' : 'Move to trash', chmod: 'Apply', chown: 'Apply' }[kind];

  const modeField = (label: string, value: string | null, set: (v: string | null) => void, initial: string) => (
    <div className="field">
      <label className="check">
        <input type="checkbox" checked={value !== null} onChange={(e) => set(e.target.checked ? initial : null)} />
        {label}
      </label>
      <input className="input mono" disabled={value === null} value={value ?? ''} onChange={(e) => set(e.target.value.trim())} inputMode="numeric" />
      <span className="hint mono">{value !== null && OCTAL.test(value) ? modeString(parseInt(value, 8)) : ' '}</span>
    </div>
  );

  return (
    <ActionDialog
      title={title}
      eyebrow="Folder"
      runner={invalid ? null : runner}
      invalid={invalid}
      onClose={onClose}
      onApplied={(jobId) => op && onApplied?.(op, jobId)}
      applyLabel={applyLabel}
    >
      {kind === 'rename' && (
        <div className="field">
          <label>New name</label>
          <input className="input" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onFocus={(e) => e.target.select()} />
        </div>
      )}

      {(kind === 'move' || kind === 'copy') && (
        <>
          <div className="seg" aria-label="Library" style={{ alignSelf: 'flex-start' }}>
            {(['media', 'import'] as const).map((r) => (
              <button
                key={r}
                className={destRoot === r ? 'active' : ''}
                onClick={() => {
                  setDestRoot(r);
                  setDest(r === folder.root ? parent : '');
                }}
              >
                {r === 'media' ? 'Media' : 'Import'}
              </button>
            ))}
          </div>
          <FolderPicker key={destRoot} root={destRoot} value={dest} onChange={setDest} rootLabel={destRoot} />
          <p className="caption muted" style={{ margin: 0 }}>
            {kind === 'move'
              ? `“${name}” and everything in it moves into the chosen folder. Nothing is overwritten.`
              : `A copy of “${name}” with everything in it is made in the chosen folder (as ${name}_1 if the name is taken). Undo moves the copy to the trash.`}
          </p>
        </>
      )}

      {kind === 'trash' && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            {permanent
              ? `“${name}” and everything in it will be deleted for good. This skips the trash and can’t be undone.`
              : `“${name}” and everything in it go to the trash as one item. Restore it from the Trash page or with Undo.`}
          </p>
          <label className="check">
            <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />
            Delete permanently (skip the trash)
          </label>
        </>
      )}

      {kind === 'chmod' && (
        <>
          <div className="row" style={{ gap: 6 }}>
            {MODE_PRESETS.map((p) => (
              <button
                key={p.label}
                className={`chip${dirMode === p.dir && fileMode === p.file ? ' active' : ''}`}
                onClick={() => {
                  setDirMode(p.dir);
                  setFileMode(p.file);
                }}
              >
                {p.label} <span className="mono subtle">{p.dir}/{p.file}</span>
              </button>
            ))}
          </div>
          <div className="grid-2">
            {modeField('Folders', dirMode, setDirMode, '755')}
            {modeField('Files', fileMode, setFileMode, '644')}
          </div>
        </>
      )}

      {kind === 'chown' && (
        <div className="grid-2">
          <div className="field">
            <label>User ID (uid)</label>
            <input className="input mono" value={uid} placeholder="unchanged" inputMode="numeric" onChange={(e) => setUid(e.target.value)} />
          </div>
          <div className="field">
            <label>Group ID (gid)</label>
            <input className="input mono" value={gid} placeholder="unchanged" inputMode="numeric" onChange={(e) => setGid(e.target.value)} />
          </div>
        </div>
      )}

      {(kind === 'chmod' || kind === 'chown') && (
        <>
          <label className="check">
            <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
            Include everything inside (subfolders and files)
          </label>
          <p className="caption muted" style={{ margin: 0 }}>
            {kind === 'chown'
              ? 'Numeric IDs as on the host (e.g. your PUID/PGID). Only root can give files to another user; without it you can change the group of the app’s own files to a group it belongs to. The preview shows what will be skipped.'
              : 'Only the owner of a file (or root) can change its permissions; the preview lists anything that will be skipped.'}
          </p>
        </>
      )}
    </ActionDialog>
  );
}
