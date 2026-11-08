import {
  CODEC_LABEL,
  bitrateOf,
  convertSkipReason,
  formatBitrate,
  formatBytes,
  type EnrichedEntry,
  type JobInfo,
  type RootName,
  type Settings,
} from '@io/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { thumbUrl } from '../api/client';
import { cancelJob, useConfig, useJobs, useSettings } from '../api/hooks';
import { ConvertDialog } from '../organize/dialogs/ConvertDialog';
import { SelectCheck } from '../organize/SelectCheck';
import { actionButtons, Workspace, type BatchAction, type WorkspaceApi } from '../organize/Workspace';

const SKIP_TEXT = { codec: 'Already efficient', bitrate: 'Low bitrate' } as const;

const duration = (s?: number) => {
  if (s === undefined) return '—';
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

const isCandidate = (e: EnrichedEntry, c: Settings['convert'] | undefined) => !!c && convertSkipReason(e, c) === null;

/** Shrink phone videos: Folders + Conversion | Video table | Preview + Metadata, for /media or /import. */
export function ConvertPage() {
  const [params, setParams] = useSearchParams();
  const root: RootName = params.get('root') === 'import' ? 'import' : 'media';
  const [open, setOpen] = useState(false);
  const config = useConfig().data;
  const c = useSettings().data?.convert;

  const actions = (w: WorkspaceApi): BatchAction[] => [
    { label: 'Convert to HEVC', run: () => setOpen(true), variant: 'primary', disabled: !config?.convertAvailable || !w.selected.some((e) => e.kind === 'video') },
  ];

  const rootSwitch = (
    <div className="seg" aria-label="Library">
      {(['media', 'import'] as const).map((r) => (
        <button key={r} className={root === r ? 'active' : ''} onClick={() => r !== root && setParams(r === 'media' ? {} : { root: r })}>
          {r === 'media' ? 'Media' : 'Import'}
        </button>
      ))}
    </div>
  );

  const bar = (w: WorkspaceApi) => {
    const videos = w.selected.filter((e) => e.kind === 'video');
    const candidates = w.visible.filter((e) => isCandidate(e, c));
    return (
      <>
        <span className="eyebrow" style={{ marginRight: 6 }}>
          {videos.length ? `${videos.length} selected · ${formatBytes(videos.reduce((s, e) => s + e.size, 0))}` : 'Select videos'}
        </span>
        {actionButtons(actions(w), videos.length)}
        <button className="btn btn-sm" disabled={!candidates.length} onClick={() => w.setSelection(new Set(candidates.map((e) => e.rel)))}>
          Select candidates
        </button>
        {config && !config.convertAvailable && <span className="warning-text caption">This server's ffmpeg has no libx265 encoder; conversion is unavailable.</span>}
        {open && <ConvertDialog selection={{ files: videos.map((e) => ({ root: e.root, rel: e.rel })) }} count={videos.length} onClose={() => setOpen(false)} />}
      </>
    );
  };

  return (
    <Workspace
      key={root}
      root={root}
      rootLabel={root}
      folderTools={rootSwitch}
      batchBar={bar}
      actions={actions}
      sidePane={{ label: 'Conversion', render: (w) => <ConvertSummary api={w} settings={c} /> }}
      content={(w) => <VideoTable api={w} settings={c} />}
      emptyText="This folder has no videos."
    />
  );
}

/** The center pane: the folder's videos with codec, bitrate and size. Rows click-select like the grid. */
function VideoTable({ api, settings: c }: { api: WorkspaceApi; settings: Settings['convert'] | undefined }) {
  const [onlyCandidates, setOnlyCandidates] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);
  const videos = api.visible.filter((e) => e.kind === 'video');
  const rows = onlyCandidates ? videos.filter((e) => isCandidate(e, c)) : videos;
  const focusedRel = api.focused?.rel;

  useEffect(() => {
    if (focusedRel) wrap.current?.querySelector(`[data-rel="${CSS.escape(focusedRel)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusedRel]);

  return (
    <div className="convert-table" ref={wrap}>
      <div className="file-list-head row">
        <div className="seg" role="tablist">
          <button role="tab" className={onlyCandidates ? 'active' : ''} onClick={() => setOnlyCandidates(true)}>
            Candidates <span className="subtle">{videos.filter((e) => isCandidate(e, c)).length}</span>
          </button>
          <button role="tab" className={!onlyCandidates ? 'active' : ''} onClick={() => setOnlyCandidates(false)}>
            All videos <span className="subtle">{videos.length}</span>
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty" style={{ minHeight: 160 }}>
          {videos.length ? 'Every video here is already small or efficient. Show all videos to see them.' : 'No videos in this folder. Tick Subfolders to scan deeper.'}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="select-col" />
              <th>Video</th>
              <th>Length</th>
              <th>Resolution</th>
              <th>Codec</th>
              <th className="num">Bitrate</th>
              <th className="num">Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const m = e.meta;
              const bps = bitrateOf(m, e.size);
              const skip = c ? convertSkipReason(e, c) : null;
              return (
                <tr
                  key={e.rel}
                  data-rel={e.rel}
                  className={`${api.selectedRels.has(e.rel) ? 'selected' : ''}${focusedRel === e.rel ? ' focused' : ''}`}
                  onClick={(ev) => api.pick(e.rel, { shift: ev.shiftKey, meta: ev.metaKey || ev.ctrlKey })}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    api.openMenu(ev.clientX, ev.clientY, e.rel);
                  }}
                >
                  <td className="select-col">
                    <SelectCheck rel={e.rel} checked={api.selectedRels.has(e.rel)} pick={api.pick} />
                  </td>
                  <td>
                    <span className="convert-name">
                      <img src={thumbUrl(e, 320)} alt="" loading="lazy" draggable={false} />
                      <span className="file-row-name" title={e.rel}>
                        {e.name}
                      </span>
                    </span>
                  </td>
                  <td className="mono">{duration(m.duration)}</td>
                  <td className="mono">{m.width && m.height ? `${m.width}×${m.height}` : '—'}</td>
                  <td>{m.videoCodec ? CODEC_LABEL[m.videoCodec] : '—'}</td>
                  <td className="mono num">{bps !== undefined ? formatBitrate(bps) : '—'}</td>
                  <td className="mono num">{formatBytes(e.size)}</td>
                  <td>{skip === 'codec' || skip === 'bitrate' ? <span className="pill">{SKIP_TEXT[skip]}</span> : <span className="pill pill-accent">Candidate</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Side pane: what's worth converting here, conversions in progress (with Cancel) and recent savings. */
function ConvertSummary({ api, settings: c }: { api: WorkspaceApi; settings: Settings['convert'] | undefined }) {
  const jobs = useJobs().data ?? [];
  const convertJobs = jobs.filter((j) => j.lane === 'convert');
  const active = convertJobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const recent = convertJobs.filter((j) => j.status === 'done' || j.status === 'cancelled').slice(0, 5);
  const videos = api.visible.filter((e) => e.kind === 'video');
  const candidates = videos.filter((e) => isCandidate(e, c));
  const total = (list: EnrichedEntry[]) => list.reduce((s, e) => s + e.size, 0);

  return (
    <div className="convert-summary stack">
      <div className="convert-stats">
        <div>
          <span className="eyebrow">Candidates</span>
          <strong>{candidates.length}</strong>
          <span className="caption muted">of {videos.length} videos</span>
        </div>
        <div>
          <span className="eyebrow">Their size</span>
          <strong>{formatBytes(total(candidates))}</strong>
          <span className="caption muted">of {formatBytes(total(videos))}</span>
        </div>
      </div>

      {active.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">In progress</span>
          {active.map((j) => (
            <ActiveJob key={j.id} job={j} />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Recent</span>
          {recent.map((j) => (
            <div key={j.id} className="caption row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <span className="grow muted">{new Date(j.finishedAt ?? j.createdAt).toLocaleString()}</span>
              {j.status === 'cancelled' && <span className="pill">Cancelled</span>}
              <span className="mono">{j.savedBytes ? `−${formatBytes(j.savedBytes)}` : '—'}</span>
            </div>
          ))}
        </div>
      )}

      {c && (
        <p className="caption subtle" style={{ margin: 0 }}>
          Candidates are videos not in {c.skipCodecs.map((x) => x.toUpperCase()).join('/') || 'an excluded codec'} and at least {c.minBitrateMbps} Mbps.
          Defaults: CRF {c.crf}, {c.preset}. <Link to="/settings">Change in Settings</Link>.
        </p>
      )}
    </div>
  );
}

function ActiveJob({ job }: { job: JobInfo }) {
  const [busy, setBusy] = useState(false);
  const cur = job.current;
  const pct = cur ? cur.pct : 0;
  return (
    <div className="card stack" style={{ gap: 6, padding: 'var(--s-sm)' }}>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <span className="grow caption job-title">
          {job.status === 'queued' ? 'Queued' : cur ? cur.file.split('/').pop() : 'Finishing…'}
        </span>
        <span className="mono caption">
          {job.status === 'running' ? `${Math.min(job.done + 1, job.total)}/${job.total} · ${pct}%` : `${job.total} file(s)`}
        </span>
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
            await cancelJob(job.id).catch(() => undefined);
          }}
        >
          {busy ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
