import {
  DUPE_THRESHOLDS,
  defaultThreshold,
  formatBytes,
  formatDisplay,
  type DupeGroup,
  type DupeMode,
  type DupeScan,
  type EnrichedEntry,
  type RootName,
} from '@io/shared';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { thumbUrl } from '../api/client';
import { cancelDupeScan, startDupeScan, useConfig, useDupeScan } from '../api/hooks';
import { TrashDialog } from '../organize/dialogs/SimpleDialogs';
import { Workspace, type WorkspaceApi } from '../organize/Workspace';

const MODES: { id: DupeMode; label: string; help: string }[] = [
  { id: 'exact', label: 'Exact', help: 'Byte-identical copies: photos and videos imported twice.' },
  { id: 'near', label: 'Near-identical', help: 'The same picture resized or recompressed, e.g. a social-media copy of an original.' },
  { id: 'similar', label: 'Similar scene', help: 'Photos that look alike (same subject and framing), taken at any time. Uses an image model.' },
];

const PHASE_TEXT: Record<DupeScan['phase'], string> = {
  listing: 'Listing files…',
  reading: 'Reading metadata',
  model: 'Loading the image model (downloads ~90 MB the first time)…',
  hashing: 'Comparing',
  grouping: 'Grouping…',
};

const thresholdLabel = (mode: DupeMode, t: number) =>
  mode === 'near' ? `Up to ${t} of 64 bits different` : `At least ${Math.round(t * 100)}% alike`;

/** Per-file Keep choices on top of each group's auto-picked file, for one scan. */
type KeepOverrides = { scanId: string | null; keep: Record<string, boolean> };

const isKept = (o: KeepOverrides, g: DupeGroup, rel: string) => o.keep[rel] ?? rel === g.keep;

/** Duplicate and similar photos: Folders + Scan | Groups | Preview + Metadata, for /media or /import. */
export function DuplicatesPage() {
  const [params, setParams] = useSearchParams();
  const root: RootName = params.get('root') === 'import' ? 'import' : 'media';
  const [threshold, setThreshold] = useState<number | undefined>();
  const scan = useDupeScan(threshold).data ?? null;
  const [overrides, setOverrides] = useState<KeepOverrides>({ scanId: null, keep: {} });
  const [trashOpen, setTrashOpen] = useState(false);

  const keep = overrides.scanId === scan?.id ? overrides : { scanId: scan?.id ?? null, keep: {} };
  const setKeep = (rels: string[], value: boolean) =>
    setOverrides({ scanId: scan?.id ?? null, keep: { ...keep.keep, ...Object.fromEntries(rels.map((r) => [r, value])) } });
  const groups = scan?.status === 'done' && scan.folder.root === root ? (scan.groups ?? []) : [];
  const unkept = groups.flatMap((g) => g.files.filter((f) => !isKept(keep, g, f.rel)));

  const rootSwitch = (
    <div className="seg" aria-label="Library">
      {(['media', 'import'] as const).map((r) => (
        <button key={r} className={root === r ? 'active' : ''} onClick={() => r !== root && setParams(r === 'media' ? {} : { root: r })}>
          {r === 'media' ? 'Media' : 'Import'}
        </button>
      ))}
    </div>
  );

  const bar = () => (
    <>
      <span className="eyebrow" style={{ marginRight: 6 }}>
        {groups.length ? `${unkept.length} to trash · ${formatBytes(unkept.reduce((s, e) => s + e.size, 0))}` : 'Scan a folder'}
      </span>
      <button className="btn btn-sm" disabled={!Object.keys(keep.keep).length} onClick={() => setOverrides({ scanId: scan?.id ?? null, keep: {} })}>
        Auto-pick best
      </button>
      <button className="btn btn-sm btn-danger" disabled={!unkept.length} onClick={() => setTrashOpen(true)}>
        Move unkept to trash
      </button>
      {trashOpen && (
        <TrashDialog selection={{ files: unkept.map((e) => ({ root: e.root, rel: e.rel })) }} count={unkept.length} onClose={() => setTrashOpen(false)} />
      )}
    </>
  );

  return (
    <Workspace
      key={root}
      root={root}
      rootLabel={root}
      folderTools={rootSwitch}
      batchBar={bar}
      sidePane={{
        label: 'Scan',
        render: (w) => <ScanPanel api={w} scan={scan} groups={groups} unkept={unkept} onScan={() => setThreshold(undefined)} onThreshold={setThreshold} />,
      }}
      content={(w) => <GroupList api={w} scan={scan} groups={groups} keep={keep} setKeep={setKeep} />}
      emptyText="This folder has no files."
    />
  );
}

/** Side pane: mode, threshold, Scan / progress / Cancel, and a summary of the result. */
function ScanPanel({
  api,
  scan,
  groups,
  unkept,
  onScan,
  onThreshold,
}: {
  api: WorkspaceApi;
  scan: DupeScan | null;
  groups: DupeGroup[];
  unkept: EnrichedEntry[];
  onScan: () => void;
  onThreshold: (t: number) => void;
}) {
  const config = useConfig().data;
  const [mode, setMode] = useState<DupeMode>(scan?.mode ?? 'exact');
  const [draft, setDraft] = useState<Partial<Record<DupeMode, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const modes = MODES.filter((m) => m.id !== 'similar' || config?.similarAvailable !== false);
  const running = scan?.status === 'running';
  const value = draft[mode] ?? (scan?.mode === mode ? scan.threshold : defaultThreshold(mode));
  // Moving the slider regroups the finished scan of this mode (no rehash); otherwise it's for the next scan.
  const regroups = scan?.status === 'done' && scan.mode === mode && scan.folder.root === api.root;
  const commit = () => regroups && draft[mode] !== undefined && onThreshold(draft[mode]!);
  const where = api.folder ? api.folder.split('/').pop() : api.root;

  const start = async () => {
    setError(null);
    try {
      onScan();
      await startDupeScan({ folder: { root: api.root, rel: api.folder }, recursive: api.recursive, mode, threshold: mode === 'exact' ? undefined : value });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="convert-summary stack">
      <div className="seg" role="tablist" style={{ alignSelf: 'flex-start' }}>
        {modes.map((m) => (
          <button key={m.id} role="tab" className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="caption muted" style={{ margin: 0 }}>
        {MODES.find((m) => m.id === mode)!.help}
      </p>

      {mode !== 'exact' && (
        <label className="stack" style={{ gap: 4 }}>
          <span className="caption">{thresholdLabel(mode, value)}</span>
          <input
            type="range"
            min={DUPE_THRESHOLDS[mode].min}
            max={DUPE_THRESHOLDS[mode].max}
            step={DUPE_THRESHOLDS[mode].step}
            // Near: fewer differing bits is stricter, so the slider runs loose → strict like Similar.
            value={mode === 'near' ? DUPE_THRESHOLDS.near.max - value : value}
            onChange={(e) => {
              const v = Number(e.target.value);
              setDraft({ ...draft, [mode]: mode === 'near' ? DUPE_THRESHOLDS.near.max - v : v });
            }}
            onPointerUp={commit}
            onKeyUp={commit}
            aria-label="Match threshold"
          />
          <span className="row caption subtle" style={{ justifyContent: 'space-between' }}>
            <span>Looser</span>
            <span>Stricter</span>
          </span>
        </label>
      )}

      {running ? (
        <ScanProgress scan={scan} />
      ) : (
        <button className="btn btn-primary" onClick={start}>
          Scan {where}
          {api.recursive ? ' + subfolders' : ''}
        </button>
      )}
      {error && <span className="error-text caption">{error}</span>}
      {scan?.status === 'failed' && <span className="error-text caption">Scan failed: {scan.error}</span>}
      {scan?.status === 'cancelled' && <span className="caption muted">Scan cancelled.</span>}
      {scan?.note && <span className="warning-text caption">{scan.note}</span>}

      {scan?.status === 'done' && (
        <>
          <div className="convert-stats">
            <div>
              <span className="eyebrow">Groups</span>
              <strong>{groups.length}</strong>
              <span className="caption muted">of {scan.fileCount} files</span>
            </div>
            <div>
              <span className="eyebrow">To trash</span>
              <strong>{formatBytes(unkept.reduce((s, e) => s + e.size, 0))}</strong>
              <span className="caption muted">{unkept.length} files</span>
            </div>
          </div>
          <p className="caption subtle" style={{ margin: 0 }}>
            {MODES.find((m) => m.id === scan.mode)!.label} scan of {scan.folder.rel || scan.folder.root}
            {scan.recursive ? ' and subfolders' : ''}, {new Date(scan.finishedAt ?? scan.startedAt).toLocaleTimeString()}.
            The best file of each group is kept: largest picture, then capture date, timezone and GPS.
          </p>
        </>
      )}
    </div>
  );
}

function ScanProgress({ scan }: { scan: DupeScan }) {
  const [busy, setBusy] = useState(false);
  const pct = scan.total ? Math.round((scan.done / scan.total) * 100) : 0;
  return (
    <div className="card stack" style={{ gap: 6, padding: 'var(--s-sm)' }}>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <span className="grow caption">{PHASE_TEXT[scan.phase]}</span>
        {scan.total > 0 && <span className="mono caption">{`${scan.done}/${scan.total}`}</span>}
      </div>
      <div className="progress">
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          className="btn btn-sm btn-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await cancelDupeScan().catch(() => undefined);
            setBusy(false);
          }}
        >
          {busy ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

/** The center pane: one card per group; click a file to preview it, tick Keep to spare it. */
function GroupList({
  api,
  scan,
  groups,
  keep,
  setKeep,
}: {
  api: WorkspaceApi;
  scan: DupeScan | null;
  groups: DupeGroup[];
  keep: KeepOverrides;
  setKeep: (rels: string[], value: boolean) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const focusedRel = api.focused?.rel;
  // One group's unkept files, while its trash dialog is open.
  const [trashFiles, setTrashFiles] = useState<DupeGroup['files'] | null>(null);

  useEffect(() => {
    if (focusedRel) wrap.current?.querySelector(`[data-rel="${CSS.escape(focusedRel)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusedRel]);

  if (!scan || scan.folder.root !== api.root || scan.status === 'failed' || scan.status === 'cancelled') {
    return <div className="empty">Pick a folder and a mode, then Scan to find duplicates.</div>;
  }
  if (scan.status === 'running') return <div className="empty">Scanning… {scan.total ? `${scan.done}/${scan.total}` : ''}</div>;
  if (!groups.length) return <div className="empty">No duplicates found in {scan.folder.rel || scan.folder.root}.</div>;

  return (
    <div className="dupe-list" ref={wrap}>
      {groups.map((g) => {
        const kept = g.files.filter((f) => isKept(keep, g, f.rel));
        const unkept = g.files.filter((f) => !isKept(keep, g, f.rel));
        return (
          <section key={g.files[0].rel} className="dupe-group">
            <div className="dupe-group-head">
              <span className="eyebrow">
                {g.files.length} files{scan.mode !== 'exact' && ` · ${Math.round(g.similarity * 100)}% alike`}
              </span>
              <span className="caption muted grow">{formatBytes(g.files.reduce((s, f) => s + f.size, 0))}</span>
              <button className="link-btn caption" disabled={kept.length === g.files.length} onClick={() => setKeep(g.files.map((f) => f.rel), true)}>
                Keep all
              </button>
              <button
                className="btn btn-sm btn-danger"
                disabled={!unkept.length}
                title={unkept.length ? `${formatBytes(unkept.reduce((s, f) => s + f.size, 0))} from this group` : 'Every file in this group is kept'}
                onClick={() => setTrashFiles(unkept)}
              >
                Trash {unkept.length} unkept
              </button>
            </div>
            <div className="dupe-tiles">
              {g.files.map((f) => {
                const on = isKept(keep, g, f.rel);
                const dir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '';
                return (
                  <div
                    key={f.rel}
                    data-rel={f.rel}
                    className={`dupe-tile${on ? ' kept' : ''}${focusedRel === f.rel ? ' focused' : ''}`}
                    onClick={() => api.pick(f.rel)}
                  >
                    <div className="tile-thumb">
                      <img src={thumbUrl(f, 320)} alt="" loading="lazy" draggable={false} />
                    </div>
                    {f.rel === g.keep && <span className="dupe-best pill">Best</span>}
                    <label className="check caption" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={on}
                        // At least one file per group stays.
                        disabled={on && kept.length === 1}
                        onChange={(e) => setKeep([f.rel], e.target.checked)}
                      />
                      {on ? 'Keep' : 'Trash'}
                    </label>
                    <div className="tile-name" title={f.rel}>
                      {f.name}
                    </div>
                    <div className="tile-meta" title={dir}>
                      {dir || '/'}
                    </div>
                    <div className="tile-meta">
                      {f.meta.width && f.meta.height ? `${f.meta.width}×${f.meta.height} · ` : ''}
                      {formatBytes(f.size)}
                    </div>
                    <div className="tile-meta">{f.resolved ? `${formatDisplay(f.resolved.local)} ${f.resolved.offset}` : 'No date'}</div>
                    <div className="row" style={{ gap: 4 }}>
                      {!f.meta.gps && <span className="pill">No GPS</span>}
                      {f.issues.some((i) => i.id === 'missingOriginalDate') && <span className="pill pill-warning">No capture date</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {trashFiles && (
        <TrashDialog selection={{ files: trashFiles.map((f) => ({ root: f.root, rel: f.rel })) }} count={trashFiles.length} onClose={() => setTrashFiles(null)} />
      )}
    </div>
  );
}
