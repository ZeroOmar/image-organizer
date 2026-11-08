import { STEP_INFO, type JobInfo, type PlanResult, type Selection, type Step } from '@io/shared';
import { useState, type ReactNode } from 'react';
import { planJob, submitJob } from '../api/hooks';
import { Dialog } from './Dialog';
import { useIsCompact } from './useCompact';

/** A job that isn't steps on a selection (e.g. a folder operation): how to dry-run and submit it. */
export interface JobRunner {
  plan: () => Promise<PlanResult>;
  submit: () => Promise<JobInfo>;
}

/**
 * Every batch action uses this two-stage dialog: a form that builds `steps`, then a dry-run
 * table from /api/jobs/plan, then Apply (queues a job; progress shows in the header Jobs menu).
 * Folder operations pass `runner` instead of `selection` + `steps`.
 */
export function ActionDialog({
  title,
  eyebrow,
  selection,
  steps,
  runner,
  invalid,
  onClose,
  onApplied,
  children,
  applyLabel = 'Apply',
  wide,
}: {
  title: string;
  eyebrow?: string;
  selection?: Selection;
  /** null while the form is incomplete. */
  steps?: Step[] | null;
  /** Instead of selection + steps; null while the form is incomplete. */
  runner?: JobRunner | null;
  invalid?: string | null;
  onClose: () => void;
  onApplied?: (jobId: string) => void;
  children: ReactNode;
  applyLabel?: string;
  wide?: boolean;
}) {
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = runner !== undefined ? !!runner : !!steps && !!selection;
  const preview = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(runner ? await runner.plan() : await planJob({ selection: selection!, steps: steps! }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const job = runner ? await runner.submit() : await submitJob({ selection: selection!, steps: steps!, title });
      onApplied?.(job.id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const changes = plan?.items.filter((i) => !i.error).length ?? 0;
  const footer = plan ? (
    <>
      <span className="muted caption grow">
        {changes} change{changes === 1 ? '' : 's'} across {plan.fileCount} file{plan.fileCount === 1 ? '' : 's'}
      </span>
      <button className="btn" onClick={() => setPlan(null)} disabled={busy}>
        Back
      </button>
      <button className="btn btn-primary" onClick={apply} disabled={busy || changes === 0}>
        {applyLabel}
      </button>
    </>
  ) : (
    <>
      {invalid && <span className="warning-text caption grow">{invalid}</span>}
      <button className="btn" onClick={onClose}>
        Cancel
      </button>
      <button className="btn btn-primary" onClick={preview} disabled={busy || !ready || !!invalid}>
        {busy ? 'Checking…' : 'Preview changes'}
      </button>
    </>
  );

  return (
    <Dialog title={title} eyebrow={eyebrow} onClose={onClose} footer={footer} wide={wide || !!plan}>
      {error && <div className="error-text">{error}</div>}
      {plan ? <PlanTable plan={plan} showStep={(steps?.length ?? 0) > 1} steps={steps ?? []} /> : children}
    </Dialog>
  );
}

export function PlanTable({ plan, showStep, steps }: { plan: PlanResult; showStep?: boolean; steps: Step[] }) {
  const compact = useIsCompact();
  return (
    <>
      {plan.warnings.map((w) => (
        <div key={w} className="warning-text caption">
          {w}
        </div>
      ))}
      {plan.items.length === 0 ? (
        <div className="empty" style={{ minHeight: 120 }}>
          Nothing to change — everything already matches.
        </div>
      ) : compact ? (
        // Phones: one card per change instead of a four-column table.
        <ul className="plan-cards">
          {plan.items.map((i, n) => (
            <li key={n} className={`plan-card${i.error ? ' error' : ''}`}>
              <div className="plan-card-head">
                <span className="mono grow">{i.file.rel.split('/').pop()}</span>
                {showStep && <span className="pill">{i.action ?? STEP_INFO[steps[i.step]?.type]?.label}</span>}
              </div>
              {i.error ? (
                <div className="error-text caption">{i.error}</div>
              ) : (
                <>
                  {i.before && i.before !== i.file.rel.split('/').pop() && <div className="muted caption plan-before">{i.before}</div>}
                  <div className="caption">→ {i.after ?? ''}</div>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="table-wrap" style={{ maxHeight: '55vh' }}>
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                {showStep && <th>Step</th>}
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {plan.items.map((i, n) => (
                <tr key={n} className={i.error ? 'error' : ''}>
                  <td className="mono">{i.file.rel.split('/').pop()}</td>
                  {showStep && <td>{i.action ?? STEP_INFO[steps[i.step]?.type]?.label}</td>}
                  <td className="muted">{i.error ? '' : (i.before ?? '')}</td>
                  <td>{i.error ?? i.after ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
