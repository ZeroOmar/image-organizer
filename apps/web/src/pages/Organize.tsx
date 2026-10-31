import type { EnrichedEntry, FileRef } from '@io/shared';
import { useState } from 'react';
import { CopyMetadataDialog } from '../organize/dialogs/CopyMetadataDialog';
import { DatesDialog } from '../organize/dialogs/DatesDialog';
import { GpsDialog } from '../organize/dialogs/GpsDialog';
import { RenameDialog } from '../organize/dialogs/RenameDialog';
import { EditTagsDialog, MoveDialog, SyncDatesDialog, TrashDialog } from '../organize/dialogs/SimpleDialogs';
import { actionButtons, Workspace, type BatchAction, type WorkspaceApi } from '../organize/Workspace';

type DialogId = 'rename' | 'dates' | 'gps' | 'copy' | 'tags' | 'sync' | 'move' | 'trash';

export function OrganizePage() {
  const [dialog, setDialog] = useState<DialogId | null>(null);
  // GPS opened from the Metadata panel: targets the shown file (or the selection that includes it).
  const [gpsFor, setGpsFor] = useState<{ files: FileRef[]; focused: EnrichedEntry } | null>(null);
  const close = () => setDialog(null);

  const actions = (): BatchAction[] => {
    const a = (id: DialogId, label: string, extra?: Partial<BatchAction>): BatchAction => ({ label, run: () => setDialog(id), ...extra });
    return [
      a('rename', 'Rename', { variant: 'primary' }),
      a('dates', 'Dates & timezone'),
      a('gps', 'GPS'),
      a('copy', 'Copy metadata', { min: 2 }),
      a('tags', 'Edit tags'),
      a('sync', 'Sync file dates'),
      a('move', 'Move'),
      a('trash', 'Trash', { variant: 'danger' }),
    ];
  };

  const bar = (w: WorkspaceApi) => {
    const n = w.selected.length;
    return (
      <>
        <span className="eyebrow" style={{ marginRight: 6 }}>
          {n ? `${n} selected` : 'Select files'}
        </span>
        {actionButtons(actions(), n)}
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
      actions={actions}
      emptyText="This folder has no photos or videos."
      onEditGps={(files, focused) => setGpsFor({ files, focused })}
    />
  );
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
