import { kindOf, type Step } from '@io/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { uploadFile } from '../api/client';
import { useConfig, useJobs } from '../api/hooks';
import { ActionDialog } from '../components/ActionDialog';
import { FolderPicker } from '../components/FolderPicker';
import { MoveDialog, TrashDialog } from '../organise/dialogs/SimpleDialogs';
import { Workspace, type WorkspaceApi } from '../organise/Workspace';

interface Upload {
  id: number;
  name: string;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
}

const PARALLEL = 2;

export function ImportPage() {
  const qc = useQueryClient();
  const maxMB = useConfig().data?.maxUploadMB;
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dialog, setDialog] = useState<'album' | 'move' | 'trash' | null>(null);
  const [lastAlbum, setLastAlbum] = useState<{ jobId: string; rel: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const folderRef = useRef('');
  const nextId = useRef(0);

  const patch = (id: number, p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const startUploads = async (folder: string, files: File[]) => {
    const accepted = files.filter((f) => kindOf(f.name));
    const rejected = files.filter((f) => !kindOf(f.name));
    const items = accepted.map((f) => ({ file: f, u: { id: nextId.current++, name: f.name, progress: 0, status: 'queued' as const } }));
    setUploads((u) => [
      ...u.filter((x) => x.status !== 'done'),
      ...items.map((i) => i.u),
      ...rejected.map((f) => ({ id: nextId.current++, name: f.name, progress: 0, status: 'error' as const, error: 'Unsupported type' })),
    ]);
    const queue = [...items];
    const worker = async () => {
      for (let it = queue.shift(); it; it = queue.shift()) {
        const { file, u } = it;
        if (maxMB && file.size > maxMB * 1024 * 1024) {
          patch(u.id, { status: 'error', error: `Larger than ${maxMB} MB` });
          continue;
        }
        patch(u.id, { status: 'uploading' });
        try {
          await uploadFile(file, folder, (p) => patch(u.id, { progress: p }));
          patch(u.id, { status: 'done', progress: 1 });
        } catch (e) {
          patch(u.id, { status: 'error', error: (e as Error).message });
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    qc.invalidateQueries({ queryKey: ['folder', 'import'] });
    qc.invalidateQueries({ queryKey: ['tree', 'import'] });
    qc.invalidateQueries({ queryKey: ['importCount'] });
  };

  const active = uploads.filter((u) => u.status === 'queued' || u.status === 'uploading');
  const failed = uploads.filter((u) => u.status === 'error');

  const toolbar = (w: WorkspaceApi) => {
    folderRef.current = w.folder;
    return (
      <>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/*,video/*,.heic,.heif"
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void startUploads(folderRef.current, [...e.target.files]);
            e.target.value = '';
          }}
        />
        <button className="btn btn-sm btn-white" onClick={() => input.current?.click()}>
          Upload
        </button>
      </>
    );
  };

  const bar = (w: WorkspaceApi) => {
    const n = w.selected.length;
    return (
      <>
        <span className="eyebrow" style={{ marginRight: 6 }}>
          {n ? `${n} selected` : 'Select files, or drop files here to upload'}
        </span>
        <button className="btn btn-sm btn-primary" disabled={!n} onClick={() => setDialog('album')}>
          Move to album
        </button>
        <button className="btn btn-sm" disabled={!n} onClick={() => setDialog('move')}>
          Move within import
        </button>
        <button className="btn btn-sm btn-danger" disabled={!n} onClick={() => setDialog('trash')}>
          Trash
        </button>
        <span className="grow" />
        {active.length > 0 && (
          <span className="caption muted">
            Uploading {active.length}… {Math.round((active.reduce((s, u) => s + u.progress, 0) / active.length) * 100)}%
          </span>
        )}
        {failed.length > 0 && (
          <details className="caption">
            <summary className="warning-text">{failed.length} upload(s) failed</summary>
            {failed.map((f) => (
              <div key={f.id}>
                {f.name}: {f.error}
              </div>
            ))}
          </details>
        )}
        <AlbumDoneLink last={lastAlbum} />
        {dialog === 'album' && (
          <MoveToAlbumDialog
            w={w}
            onClose={() => setDialog(null)}
            onApplied={(jobId, rel) => setLastAlbum({ jobId, rel })}
          />
        )}
        {dialog === 'move' && <MoveDialog selection={w.selection} root="import" current={w.folder} onClose={() => setDialog(null)} />}
        {dialog === 'trash' && <TrashDialog selection={w.selection} count={n} onClose={() => setDialog(null)} />}
      </>
    );
  };

  return (
    <Workspace
      root="import"
      rootLabel="import"
      toolbar={toolbar}
      batchBar={bar}
      onDropFiles={(folder, files) => void startUploads(folder, files)}
      emptyText="Nothing to import. Upload files or drop them here — files added to the /import mount show up too."
    />
  );
}

function AlbumDoneLink({ last }: { last: { jobId: string; rel: string } | null }) {
  const job = useJobs().data?.find((j) => j.id === last?.jobId);
  if (!last || job?.status !== 'done') return null;
  return (
    <Link className="btn btn-sm" to={`/organise?path=${encodeURIComponent(last.rel)}`}>
      Open album in Organise →
    </Link>
  );
}

/** Import → album: optional "write resolved date" before the move, then rename + sync inside the album. */
function MoveToAlbumDialog({ w, onClose, onApplied }: { w: WorkspaceApi; onClose: () => void; onApplied: (jobId: string, rel: string) => void }) {
  const [dest, setDest] = useState('');
  const [applyDates, setApplyDates] = useState(true);
  const [rename, setRename] = useState(true);
  const [sync, setSync] = useState(false);
  const steps: Step[] = [
    ...(applyDates ? [{ type: 'applyDates' } as Step] : []),
    { type: 'move', dest: { root: 'media', rel: dest } },
    // Rename after the move so numbering accounts for files already in the album.
    ...(rename ? [{ type: 'rename' } as Step] : []),
    ...(sync ? [{ type: 'syncFileDates' } as Step] : []),
  ];
  return (
    <ActionDialog
      title="Move to album"
      eyebrow={`${w.selected.length} file(s) from import`}
      selection={w.selection}
      steps={steps}
      invalid={dest === '' ? 'Choose or create an album folder under media' : null}
      onClose={onClose}
      onApplied={(jobId) => onApplied(jobId, dest)}
      applyLabel="Move to album"
    >
      <FolderPicker root="media" value={dest} onChange={setDest} rootLabel="media" />
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">While moving</span>
        <label className="check">
          <input type="checkbox" checked={applyDates} onChange={(e) => setApplyDates(e.target.checked)} />
          Write resolved date + timezone into the files
        </label>
        <label className="check">
          <input type="checkbox" checked={rename} onChange={(e) => setRename(e.target.checked)} />
          Rename by template (inside the album)
        </label>
        <label className="check">
          <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
          Sync file dates to capture date
        </label>
      </div>
    </ActionDialog>
  );
}
