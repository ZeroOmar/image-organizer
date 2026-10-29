import type { JobInfo } from '@io/shared';
import { useEffect, useRef, useState } from 'react';
import { undoJob, useJobs } from '../api/hooks';

const STORE = 'io.dismissedJobs';

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORE) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(s: Set<string>) {
  try {
    // Keep the list bounded; the server only returns the last 50 jobs anyway.
    localStorage.setItem(STORE, JSON.stringify([...s].slice(-300)));
  } catch {
    /* storage unavailable */
  }
}

const isActive = (j: JobInfo) => j.status === 'queued' || j.status === 'running';

/**
 * Header button + dropdown listing jobs (progress, errors, Undo, Dismiss). Running jobs can't be
 * dismissed. Dismissals persist per browser in localStorage.
 */
export function JobsMenu() {
  const { data: jobs = [] } = useJobs();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dismiss = (ids: string[]) =>
    setDismissed((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      saveDismissed(next);
      return next;
    });

  const visible = jobs.filter((j) => isActive(j) || !dismissed.has(j.id));
  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const failed = visible.filter((j) => j.status === 'failed' || (j.status === 'done' && j.errors.length > 0)).length;
  const finished = visible.filter((j) => !isActive(j));
  const active = running + queued;

  return (
    <div className="jobs-menu" ref={root}>
      <button
        className={`btn btn-ghost jobs-button${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Jobs: ${active} running, ${failed} with errors`}
        aria-expanded={open}
        title="Jobs"
      >
        <JobsIcon spinning={running > 0} />
        {active > 0 ? <span className="jobs-badge">{active}</span> : failed > 0 ? <span className="jobs-badge error">{failed}</span> : null}
      </button>
      {open && (
        <div className="jobs-panel" role="dialog" aria-label="Jobs">
          <div className="jobs-panel-head">
            <strong className="grow">Jobs</strong>
            <span className="jobs-count" title="Running">
              {running} <span className="dot dot-run" />
            </span>
            <span className="jobs-count" title="Queued">
              {queued} <span className="dot dot-queue" />
            </span>
            <span className="jobs-count" title="Failed or with errors">
              {failed} <span className="dot dot-fail" />
            </span>
          </div>
          <div className="jobs-panel-body">
            {visible.length === 0 ? (
              <div className="empty" style={{ minHeight: 120 }}>
                <div>
                  <div style={{ fontSize: 22 }}>ⓘ</div>
                  No jobs.
                </div>
              </div>
            ) : (
              visible.slice(0, 30).map((j) => <JobRow key={j.id} job={j} onDismiss={() => dismiss([j.id])} />)
            )}
          </div>
          <div className="jobs-panel-foot">
            <span className="caption subtle grow">{active ? `${active} in progress` : 'Nothing running'}</span>
            <button className="btn btn-sm" disabled={!finished.length} onClick={() => dismiss(finished.map((j) => j.id))}>
              Dismiss all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function JobRow({ job, onDismiss }: { job: JobInfo; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  const pct = job.total ? Math.round((job.done / job.total) * 100) : job.status === 'done' ? 100 : 0;
  const active = isActive(job);
  const pill =
    job.status === 'done' ? (
      <span className={`pill ${job.errors.length ? 'pill-warning' : 'pill-accent'}`}>{job.errors.length ? `${job.errors.length} errors` : 'Done'}</span>
    ) : job.status === 'failed' ? (
      <span className="pill pill-error">Failed</span>
    ) : job.status === 'undone' ? (
      <span className="pill">Undone</span>
    ) : (
      <span className="pill">{job.status === 'queued' ? 'Queued' : `${job.done}/${job.total}`}</span>
    );
  return (
    <div className="job-row">
      <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
        <span className="grow job-title" title={job.title}>
          {job.title}
        </span>
        {pill}
      </div>
      {active && (
        <div className="progress">
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
      {job.status === 'done' && job.total === 0 && <span className="caption muted">Nothing needed changing.</span>}
      {job.errors.length > 0 && (
        <details className="caption">
          <summary className="warning-text">Show errors</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {job.errors.slice(0, 20).map((e, i) => (
              <li key={i}>
                {e.file && <span className="mono">{e.file}: </span>}
                {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <span className="caption subtle">{new Date(job.finishedAt ?? job.createdAt).toLocaleTimeString()}</span>
        <span className="row" style={{ gap: 6 }}>
          {job.undoable && (
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await undoJob(job.id).finally(() => setBusy(false));
              }}
            >
              Undo
            </button>
          )}
          {!active && (
            <button className="btn btn-sm btn-ghost" onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function JobsIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg className={spinning ? 'spin' : undefined} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {spinning ? (
        <>
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 3v6h-6" />
        </>
      ) : (
        <>
          <path d="M9 6h11" />
          <path d="M9 12h11" />
          <path d="M9 18h11" />
          <path d="M4 6l1 1 2-2" />
          <path d="M4 12l1 1 2-2" />
          <path d="M4 18l1 1 2-2" />
        </>
      )}
    </svg>
  );
}
