import type { EnrichedEntry, FileRef, RootName } from '@io/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ActionDialog } from '../components/ActionDialog';
import { FileList } from '../gps/FileList';
import { GpsMap } from '../gps/GpsMap';
import { GpsDialog } from '../organize/dialogs/GpsDialog';
import { actionButtons, Workspace, type BatchAction, type WorkspaceApi } from '../organize/Workspace';

type DialogId = 'set' | 'tighten' | 'clear';

/** GPS management on a map: Folders + Files | Map | Preview + Metadata, for /media or /import. */
export function GpsPage() {
  const [params, setParams] = useSearchParams();
  const root: RootName = params.get('root') === 'import' ? 'import' : 'media';
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const [gpsFor, setGpsFor] = useState<{ files: FileRef[]; focused: EnrichedEntry } | null>(null);
  const close = () => setDialog(null);

  const actions = (): BatchAction[] => [
    { label: 'Set GPS…', run: () => setDialog('set'), variant: 'primary' },
    { label: 'Tighten…', run: () => setDialog('tighten'), min: 2 },
    { label: 'Clear GPS', run: () => setDialog('clear'), variant: 'danger' },
  ];

  const toolbar = () => (
    <div className="seg" aria-label="Library">
      {(['media', 'import'] as const).map((r) => (
        <button key={r} className={root === r ? 'active' : ''} onClick={() => r !== root && setParams(r === 'media' ? {} : { root: r })}>
          {r === 'media' ? 'Media' : 'Import'}
        </button>
      ))}
    </div>
  );

  const bar = (w: WorkspaceApi) => {
    const n = w.selected.length;
    return (
      <>
        <span className="eyebrow" style={{ marginRight: 6 }}>
          {n ? `${n} selected` : 'Select files'}
        </span>
        {actionButtons(actions(), n)}
        {dialog === 'set' && <GpsDialog selection={w.selection} focused={w.focused} entries={w.entries} onClose={close} />}
        {dialog === 'tighten' && <TightenDialog w={w} onClose={close} />}
        {dialog === 'clear' && (
          <ActionDialog title="Clear GPS" eyebrow={`${n} file(s)`} selection={w.selection} steps={[{ type: 'clearGps' }]} onClose={close} applyLabel="Clear GPS">
            <p className="muted" style={{ margin: 0 }}>
              Removes the GPS position from the selected files. You can undo it from the Jobs menu.
            </p>
          </ActionDialog>
        )}
        {gpsFor && <GpsDialog selection={{ files: gpsFor.files }} focused={gpsFor.focused} entries={w.entries} onClose={() => setGpsFor(null)} />}
      </>
    );
  };

  return (
    <Workspace
      key={root}
      root={root}
      rootLabel={root}
      toolbar={toolbar}
      batchBar={bar}
      actions={actions}
      sidePane={{ label: 'Files', render: (w) => <FileList api={w} /> }}
      content={(w) => <GpsMap api={w} />}
      emptyText="This folder has no photos or videos."
      onEditGps={(files, focused) => setGpsFor({ files, focused })}
    />
  );
}

/** Tighten the selection's positions toward their average (the batch-bar version of the map's circle tool). */
function TightenDialog({ w, onClose }: { w: WorkspaceApi; onClose: () => void }) {
  const [tighten, setTighten] = useState(80);
  const located = w.selected.filter((e) => e.meta.gps);
  const center = located.length
    ? { lat: located.reduce((s, e) => s + e.meta.gps!.lat, 0) / located.length, lon: located.reduce((s, e) => s + e.meta.gps!.lon, 0) / located.length }
    : null;
  return (
    <ActionDialog
      title="Tighten GPS cluster"
      eyebrow={`${located.length} of ${w.selected.length} file(s) have GPS`}
      selection={{ files: located.map((e) => ({ root: e.root, rel: e.rel })) }}
      steps={center ? [{ type: 'gatherGps', lat: center.lat, lon: center.lon, scale: 1 - tighten / 100 }] : null}
      invalid={located.length < 2 ? 'Select at least two files with GPS' : !tighten ? 'Choose how much to tighten' : null}
      onClose={onClose}
    >
      <p className="muted" style={{ margin: 0 }}>
        Pulls each position toward the group's average, keeping their layout. 100% puts them all on one point.
      </p>
      <label className="row">
        <span className="eyebrow">Tighten</span>
        <input type="range" className="grow" min={5} max={100} step={5} value={tighten} onChange={(e) => setTighten(Number(e.target.value))} />
        <span className="mono">{tighten}%</span>
      </label>
    </ActionDialog>
  );
}
