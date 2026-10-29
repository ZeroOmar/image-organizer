import type { EnrichedEntry, FileRef } from '@io/shared';
import { useState } from 'react';
import { CopyMetadataDialog } from '../organise/dialogs/CopyMetadataDialog';
import { DatesDialog } from '../organise/dialogs/DatesDialog';
import { GpsDialog } from '../organise/dialogs/GpsDialog';
import { RenameDialog } from '../organise/dialogs/RenameDialog';
import { EditTagsDialog, MoveDialog, SyncDatesDialog, TrashDialog } from '../organise/dialogs/SimpleDialogs';
import { Workspace, type WorkspaceApi } from '../organise/Workspace';

type DialogId = 'rename' | 'dates' | 'gps' | 'copy' | 'tags' | 'sync' | 'move' | 'trash';

export function OrganisePage() {
  const [dialog, setDialog] = useState<DialogId | null>(null);
  // GPS opened from the Metadata panel: targets the shown file (or the selection that includes it).
  const [gpsFor, setGpsFor] = useState<{ files: FileRef[]; focused: EnrichedEntry } | null>(null);
  const close = () => setDialog(null);

  const bar = (w: WorkspaceApi) => {
    const n = w.selected.length;
    const b = (id: DialogId, label: string, cls = 'btn btn-sm', min = 1) => (
      <button className={cls} disabled={n < min} onClick={() => setDialog(id)}>
        {label}
      </button>
    );
    return (
      <>
        <span className="eyebrow" style={{ marginRight: 6 }}>
          {n ? `${n} selected` : 'Select files'}
        </span>
        {b('rename', 'Rename', 'btn btn-sm btn-primary')}
        {b('dates', 'Dates & timezone')}
        {b('gps', 'GPS')}
        {b('copy', 'Copy metadata', 'btn btn-sm', 2)}
        {b('tags', 'Edit tags')}
        {b('sync', 'Sync file dates')}
        {b('move', 'Move')}
        {b('trash', 'Trash', 'btn btn-sm btn-danger')}
        {dialog && <Dialogs id={dialog} w={w} onClose={close} />}
        {gpsFor && (
          <GpsDialog selection={{ files: gpsFor.files }} focused={gpsFor.focused} entries={w.entries} onClose={() => setGpsFor(null)} />
        )}
      </>
    );
  };

  return (
    <Workspace
      root="media"
      rootLabel="media"
      batchBar={bar}
      emptyText="This folder has no photos or videos."
      onEditGps={(files, focused) => setGpsFor({ files, focused })}
    />
  );;
}

function Dialogs({ id, w, onClose }: { id: DialogId; w: WorkspaceApi; onClose: () => void }) {
  switch (id) {
    case 'rename':
      return <RenameDialog selection={w.selection} onClose={onClose} />;
    case 'dates':
      return <DatesDialog selection={w.selection} focused={w.focused} onClose={onClose} />;
    case 'gps':
      return <GpsDialog selection={w.selection} focused={w.focused} entries={w.entries} onClose={onClose} />;
    case 'copy':
      return <CopyMetadataDialog selection={w.selection} entries={w.selected} focused={w.focused} onClose={onClose} />;
    case 'tags':
      return <EditTagsDialog selection={w.selection} focused={w.focused} onClose={onClose} />;
    case 'sync':
      return <SyncDatesDialog selection={w.selection} onClose={onClose} />;
    case 'move':
      return <MoveDialog selection={w.selection} root="media" current={w.folder} onClose={onClose} />;
    case 'trash':
      return <TrashDialog selection={w.selection} count={w.selected.length} onClose={onClose} />;
  }
}
