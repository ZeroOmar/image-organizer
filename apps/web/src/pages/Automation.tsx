import { STEP_INFO, isValidZone, type PlanResult, type Rule, type Step, type StepType } from '@io/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { keys, useJobs, useRules } from '../api/hooks';
import { PlanTable } from '../components/ActionDialog';
import { Dialog } from '../components/Dialog';
import { FolderPicker } from '../components/FolderPicker';
import { TimezoneInput } from '../organize/dialogs/DatesDialog';

type Draft = Omit<Rule, 'id' | 'lastRunAt' | 'lastJobId'> & { id?: string };

const CRON_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every night at 02:00', value: '0 2 * * *' },
  { label: 'Every Sunday 03:00', value: '0 3 * * 0' },
];

const AUTOMATION_STEPS = (Object.keys(STEP_INFO) as StepType[]).filter((t) => STEP_INFO[t].automation);

function defaultStep(type: StepType): Step {
  switch (type) {
    case 'shiftDates':
      return { type, seconds: 3600 };
    case 'setTimezone':
      return { type, tz: 'UTC', keep: 'wall' };
    case 'setGps':
      return { type, lat: 0, lon: 0, alt: null };
    case 'move':
      return { type, dest: { root: 'media', rel: '' } };
    case 'moveByDate':
      return { type, pattern: '{YYYY}/{YYYY}-{MM}' };
    default:
      return { type } as Step;
  }
}

const newRule = (): Draft => ({
  name: 'Inbox: fix dates and file by month',
  enabled: true,
  target: { folder: { root: 'import', rel: '' }, recursive: true },
  steps: [{ type: 'applyDates' }, { type: 'moveByDate', pattern: '{YYYY}/{YYYY}-{MM}' }, { type: 'rename' }],
  schedule: null,
  watch: false,
});

export function AutomationPage() {
  const qc = useQueryClient();
  const { data: rules = [] } = useRules();
  const jobs = useJobs().data ?? [];
  const [edit, setEdit] = useState<Draft | null>(null);
  const [plan, setPlan] = useState<{ rule: Rule; result: PlanResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
    qc.invalidateQueries({ queryKey: keys.rules });
  };

  return (
    <div className="page-inner">
      <div className="row" style={{ marginBottom: 24 }}>
        <div className="grow">
          <div className="eyebrow">Rule pipelines</div>
          <h1 className="display-md">Automation</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setEdit(newRule())}>
          New rule
        </button>
      </div>
      <p className="muted body-lg" style={{ maxWidth: 760 }}>
        A rule runs its steps, in order, on a folder: on demand, on a schedule, or when new files land there (watch). Every run is a normal job — you
        can see it in the Jobs menu (top right) and undo it.
      </p>
      {error && <p className="error-text">{error}</p>}
      {rules.length === 0 ? (
        <div className="card empty">No rules yet.</div>
      ) : (
        <div className="stack">
          {rules.map((r) => {
            const last = jobs.find((j) => j.id === r.lastJobId);
            return (
              <div className="card" key={r.id}>
                <div className="row">
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <h2 className="card-title">{r.name}</h2>
                      {!r.enabled && <span className="pill">Disabled</span>}
                      {r.watch && <span className="pill pill-accent">Watching</span>}
                      {r.schedule && <span className="pill mono">{r.schedule}</span>}
                    </div>
                    <div className="caption muted" style={{ marginTop: 4 }}>
                      {r.target.folder.root}/{r.target.folder.rel}
                      {r.target.recursive ? ' (with subfolders)' : ''} · {r.steps.map((s) => STEP_INFO[s.type].label).join(' → ')}
                    </div>
                    <div className="caption subtle" style={{ marginTop: 4 }}>
                      {r.lastRunAt ? `Last run ${new Date(r.lastRunAt).toLocaleString()}` : 'Never run'}
                      {last && ` · ${last.status}${last.errors.length ? `, ${last.errors.length} errors` : ''}`}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm"
                    onClick={() => call(async () => setPlan({ rule: r, result: await api<PlanResult>(`/api/rules/${r.id}/plan`, { method: 'POST' }) }))}
                  >
                    Dry run
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => call(() => api(`/api/rules/${r.id}/run`, { method: 'POST' }))}>
                    Run now
                  </button>
                  <button className="btn btn-sm" onClick={() => setEdit({ ...r })}>
                    Edit
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => call(() => api(`/api/rules/${r.id}`, { method: 'DELETE' }))}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {edit && <RuleEditor draft={edit} onClose={() => setEdit(null)} />}
      {plan && (
        <Dialog
          title={`Dry run: ${plan.rule.name}`}
          onClose={() => setPlan(null)}
          wide
          footer={
            <button className="btn" onClick={() => setPlan(null)}>
              Close
            </button>
          }
        >
          <PlanTable plan={plan.result} showStep steps={plan.rule.steps} />
        </Dialog>
      )}
    </div>
  );
}

function RuleEditor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(draft);
  const [error, setError] = useState<string | null>(null);
  const [add, setAdd] = useState<StepType>('applyDates');

  const setStep = (i: number, s: Step) => setD({ ...d, steps: d.steps.map((x, j) => (j === i ? s : x)) });
  const moveStep = (i: number, dir: -1 | 1) => {
    const arr = [...d.steps];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setD({ ...d, steps: arr });
  };

  const save = async () => {
    setError(null);
    try {
      const { id, ...body } = d;
      await api(id ? `/api/rules/${id}` : '/api/rules', { method: id ? 'PUT' : 'POST', body });
      qc.invalidateQueries({ queryKey: keys.rules });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog
      title={d.id ? 'Edit rule' : 'New rule'}
      eyebrow="Automation"
      onClose={onClose}
      wide
      footer={
        <>
          {error && <span className="error-text caption grow">{error}</span>}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!d.name.trim() || !d.steps.length}>
            Save rule
          </button>
        </>
      }
    >
      <div className="grid-2">
        <div className="field">
          <label>Name</label>
          <input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </div>
        <div className="field">
          <label>Runs</label>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} />
              Enabled
            </label>
            <label className="check">
              <input type="checkbox" checked={d.watch} onChange={(e) => setD({ ...d, watch: e.target.checked })} />
              When files arrive
            </label>
          </div>
        </div>
      </div>
      <div className="field">
        <label>Schedule (cron, optional)</label>
        <div className="row">
          <input
            className="input mono grow"
            placeholder="e.g. 0 2 * * *"
            value={d.schedule ?? ''}
            onChange={(e) => setD({ ...d, schedule: e.target.value.trim() ? e.target.value : null })}
          />
          {CRON_PRESETS.map((p) => (
            <button key={p.value} className="btn btn-sm" onClick={() => setD({ ...d, schedule: p.value })}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Target folder</label>
        <div className="row">
          <select
            className="input"
            style={{ width: 140 }}
            value={d.target.folder.root}
            onChange={(e) => setD({ ...d, target: { ...d.target, folder: { root: e.target.value as 'media' | 'import', rel: '' } } })}
          >
            <option value="import">import</option>
            <option value="media">media</option>
          </select>
          <label className="check">
            <input type="checkbox" checked={d.target.recursive} onChange={(e) => setD({ ...d, target: { ...d.target, recursive: e.target.checked } })} />
            Include subfolders
          </label>
        </div>
        <FolderPicker
          root={d.target.folder.root}
          value={d.target.folder.rel}
          onChange={(rel) => setD({ ...d, target: { ...d.target, folder: { ...d.target.folder, rel } } })}
          rootLabel={d.target.folder.root}
        />
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Steps (run in order)</span>
        {d.steps.map((s, i) => (
          <div key={i} className="list-row" style={{ alignItems: 'flex-start' }}>
            <span className="pill" style={{ marginTop: 6 }}>
              {i + 1}
            </span>
            <div className="grow stack" style={{ gap: 6 }}>
              <strong>{STEP_INFO[s.type].label}</strong>
              <span className="caption muted">{STEP_INFO[s.type].description}</span>
              <StepParams step={s} onChange={(n) => setStep(i, n)} />
            </div>
            <button className="btn btn-ghost icon-btn" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="Move up">
              ↑
            </button>
            <button className="btn btn-ghost icon-btn" onClick={() => moveStep(i, 1)} disabled={i === d.steps.length - 1} aria-label="Move down">
              ↓
            </button>
            <button className="btn btn-ghost icon-btn" onClick={() => setD({ ...d, steps: d.steps.filter((_, j) => j !== i) })} aria-label="Remove">
              ✕
            </button>
          </div>
        ))}
        <div className="row">
          <select className="input" style={{ width: 260 }} value={add} onChange={(e) => setAdd(e.target.value as StepType)}>
            {AUTOMATION_STEPS.map((t) => (
              <option key={t} value={t}>
                {STEP_INFO[t].label}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => setD({ ...d, steps: [...d.steps, defaultStep(add)] })}>
            + Add step
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function StepParams({ step: s, onChange }: { step: Step; onChange: (s: Step) => void }) {
  switch (s.type) {
    case 'shiftDates':
      return (
        <div className="row">
          <input className="input" type="number" style={{ width: 160 }} value={s.seconds} onChange={(e) => onChange({ ...s, seconds: Math.trunc(Number(e.target.value) || 0) })} />
          <span className="caption muted">seconds (negative = back)</span>
        </div>
      );
    case 'setTimezone':
      return (
        <div className="row">
          <div style={{ width: 240 }}>
            <TimezoneInput value={s.tz} onChange={(tz) => onChange({ ...s, tz })} />
          </div>
          <select className="input" style={{ width: 200 }} value={s.keep} onChange={(e) => onChange({ ...s, keep: e.target.value as 'wall' | 'instant' })}>
            <option value="wall">Keep clock time</option>
            <option value="instant">Keep instant</option>
          </select>
          {!isValidZone(s.tz) && <span className="warning-text caption">Unknown timezone</span>}
        </div>
      );
    case 'setGps':
      return (
        <div className="row">
          <input className="input mono" style={{ width: 140 }} value={s.lat} onChange={(e) => onChange({ ...s, lat: Number(e.target.value) || 0 })} aria-label="Latitude" />
          <input className="input mono" style={{ width: 140 }} value={s.lon} onChange={(e) => onChange({ ...s, lon: Number(e.target.value) || 0 })} aria-label="Longitude" />
        </div>
      );
    case 'move':
      return <FolderPicker root="media" value={s.dest.rel} onChange={(rel) => onChange({ ...s, dest: { root: 'media', rel } })} rootLabel="media" />;
    case 'moveByDate':
      return (
        <div className="field">
          <input className="input mono" value={s.pattern} onChange={(e) => onChange({ ...s, pattern: e.target.value })} />
          <span className="hint">
            Folder under /media. Tokens: {'{YYYY} {YY} {MM} {DD} {TYPE}'}, e.g. <span className="mono">{'{YYYY}/{YYYY}-{MM}'}</span>
          </span>
        </div>
      );
    case 'rename':
      return <span className="caption muted">Uses the templates from Settings.</span>;
    default:
      return null;
  }
}
