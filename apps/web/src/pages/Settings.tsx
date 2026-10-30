import {
  DATE_SOURCES,
  ISSUE_CHECKS,
  defaultSettings,
  parseTemplate,
  previewTemplate,
  type DateSourceId,
  type Settings,
} from '@io/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useConfig, useSaveSettings, useSettings } from '../api/hooks';
import { TokenPalette } from '../organize/dialogs/RenameDialog';

export function SettingsPage() {
  const { data } = useSettings();
  if (!data) return null;
  return <SettingsForm initial={data} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const save = useSaveSettings();
  const config = useConfig().data;
  const [s, setS] = useState<Settings>(initial);
  const [focusTpl, setFocusTpl] = useState<'photo' | 'video'>('photo');
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  useEffect(() => setS(initial), [initial]);
  const defaults = defaultSettings();

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSaved(false);
    setS({ ...s, [k]: v });
  };
  const tplErrors = (['photo', 'video'] as const).flatMap((k) => parseTemplate(s.rename.templates[k]).errors.map((e) => `${k}: ${e}`));

  const move = (i: number, d: -1 | 1) => {
    const arr = [...s.dateSources];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set('dateSources', arr);
  };
  const unused = DATE_SOURCES.filter((d) => !s.dateSources.includes(d.id));

  return (
    <div className="page-inner" style={{ maxWidth: 900 }}>
      <div className="row" style={{ marginBottom: 32, position: 'sticky', top: 0, background: 'var(--canvas)', zIndex: 2, padding: '8px 0' }}>
        <div className="grow">
          <div className="eyebrow">
            Preferences{config?.version && <span style={{ textTransform: 'none' }}> · Image Organizer v{config.version}</span>}
          </div>
          <h1 className="display-md">Settings</h1>
        </div>
        {saved && !dirty && <span className="pill pill-accent">Saved</span>}
        {save.error && <span className="error-text">{(save.error as Error).message}</span>}
        <button className="btn" disabled={!dirty} onClick={() => setS(initial)}>
          Discard
        </button>
        <button
          className="btn btn-primary"
          disabled={!dirty || tplErrors.length > 0 || save.isPending}
          onClick={() => save.mutate(s, { onSuccess: () => setSaved(true) })}
        >
          Save changes
        </button>
      </div>

      <section className="section">
        <span className="eyebrow">Date source priority</span>
        <div className="card stack">
          <p className="muted" style={{ margin: 0 }}>
            The first source a file has decides its capture date (used for names, issues and “Write resolved date”). Date-only sources such as
            WhatsApp names borrow the time from the next source on the same day.
          </p>
          {s.dateSources.map((id, i) => {
            const d = DATE_SOURCES.find((x) => x.id === id)!;
            return (
              <div className="list-row" key={id}>
                <span className="pill">{i + 1}</span>
                <div className="grow">
                  <strong>{d.label}</strong>
                  <div className="caption muted">{d.description}</div>
                </div>
                <button className="btn btn-ghost icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  ↑
                </button>
                <button className="btn btn-ghost icon-btn" onClick={() => move(i, 1)} disabled={i === s.dateSources.length - 1} aria-label="Move down">
                  ↓
                </button>
                <button
                  className="btn btn-ghost icon-btn"
                  onClick={() => set('dateSources', s.dateSources.filter((x) => x !== id))}
                  disabled={s.dateSources.length === 1}
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            );
          })}
          {unused.length > 0 && (
            <div className="row">
              {unused.map((d) => (
                <button key={d.id} className="btn btn-sm" onClick={() => set('dateSources', [...s.dateSources, d.id as DateSourceId])}>
                  + {d.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <span className="eyebrow">Rename templates</span>
        <div className="card stack">
          {(['photo', 'video'] as const).map((k) => (
            <div className="field" key={k}>
              <label>{k === 'photo' ? 'Photos' : 'Videos'}</label>
              <input
                className="input mono"
                id={`tpl-${k}`}
                value={s.rename.templates[k]}
                onFocus={() => setFocusTpl(k)}
                onChange={(e) => set('rename', { ...s.rename, templates: { ...s.rename.templates, [k]: e.target.value } })}
              />
              <span className="hint mono">
                {previewTemplate(s.rename.templates[k], k, s) || '—'} · on conflict: {previewTemplate(s.rename.templates[k], k, s, '0'.repeat(s.rename.counter.digits - 1) + '1') || '—'}
              </span>
            </div>
          ))}
          <TokenPalette
            onInsert={(t) => {
              const el = document.getElementById(`tpl-${focusTpl}`) as HTMLInputElement | null;
              const v = s.rename.templates[focusTpl];
              const a = el?.selectionStart ?? v.length;
              const b = el?.selectionEnd ?? v.length;
              set('rename', { ...s.rename, templates: { ...s.rename.templates, [focusTpl]: v.slice(0, a) + t + v.slice(b) } });
            }}
          />
          {tplErrors.map((e) => (
            <div key={e} className="warning-text caption">
              {e}
            </div>
          ))}
          <div className="grid-2">
            <div className="field">
              <label>{'{TYPE}'} for photos</label>
              <input className="input" value={s.rename.typeLabels.photo} onChange={(e) => set('rename', { ...s.rename, typeLabels: { ...s.rename.typeLabels, photo: e.target.value } })} />
            </div>
            <div className="field">
              <label>{'{TYPE}'} for videos</label>
              <input className="input" value={s.rename.typeLabels.video} onChange={(e) => set('rename', { ...s.rename, typeLabels: { ...s.rename.typeLabels, video: e.target.value } })} />
            </div>
            <div className="field">
              <label>{'{XX}'} digits</label>
              <input
                className="input"
                type="number"
                min={1}
                max={4}
                value={s.rename.counter.digits}
                onChange={(e) => set('rename', { ...s.rename, counter: { ...s.rename.counter, digits: Math.min(4, Math.max(1, Number(e.target.value) || 1)) } })}
              />
            </div>
            <div className="field">
              <label>{'{XX}'} starts at</label>
              <input
                className="input"
                type="number"
                min={0}
                value={s.rename.counter.start}
                onChange={(e) => set('rename', { ...s.rename, counter: { ...s.rename.counter, start: Math.max(0, Number(e.target.value) || 0) } })}
              />
            </div>
          </div>
          <p className="caption muted" style={{ margin: 0 }}>
            When several files resolve to the same name, all of them are numbered (…094004<b>01</b>, …094004<b>02</b>); unique names get no counter.
          </p>
          <div>
            <button className="btn btn-sm" onClick={() => set('rename', defaults.rename)}>
              Reset templates to defaults
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <span className="eyebrow">Extensions</span>
        <div className="card stack">
          <label className="check">
            <input type="checkbox" checked={s.extensions.lowercase} onChange={(e) => set('extensions', { ...s.extensions, lowercase: e.target.checked })} />
            Lower-case extensions when renaming (.JPG → .jpg)
          </label>
          {Object.entries(s.extensions.map).map(([from, to], i) => (
            <div className="row" key={i}>
              <input
                className="input mono"
                style={{ width: 140 }}
                value={from}
                onChange={(e) => {
                  const entries = Object.entries(s.extensions.map);
                  entries[i] = [e.target.value.toLowerCase(), to];
                  set('extensions', { ...s.extensions, map: Object.fromEntries(entries) });
                }}
              />
              <span className="muted">→</span>
              <input
                className="input mono"
                style={{ width: 140 }}
                value={to}
                onChange={(e) => set('extensions', { ...s.extensions, map: { ...s.extensions.map, [from]: e.target.value.toLowerCase() } })}
              />
              <button
                className="btn btn-ghost icon-btn"
                aria-label="Remove"
                onClick={() => set('extensions', { ...s.extensions, map: Object.fromEntries(Object.entries(s.extensions.map).filter(([k]) => k !== from)) })}
              >
                ✕
              </button>
            </div>
          ))}
          <div>
            <button className="btn btn-sm" onClick={() => set('extensions', { ...s.extensions, map: { ...s.extensions.map, '.ext': '.ext' } })}>
              + Add mapping
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <span className="eyebrow">Issue highlighting</span>
        <div className="card stack">
          <label className="check">
            <input type="checkbox" checked={s.issues.enabled} onChange={(e) => set('issues', { ...s.issues, enabled: e.target.checked })} />
            Highlight files with missing metadata or mismatched dates in Organize and Import
          </label>
          <div className="grid-2" style={{ opacity: s.issues.enabled ? 1 : 0.5 }}>
            {ISSUE_CHECKS.map((c) => (
              <label className="check" key={c.id}>
                <input
                  type="checkbox"
                  disabled={!s.issues.enabled}
                  checked={s.issues.checks[c.id] !== false}
                  onChange={(e) => set('issues', { ...s.issues, checks: { ...s.issues.checks, [c.id]: e.target.checked } })}
                />
                <span>
                  {c.label}{' '}
                  <span className={`pill ${c.category === 'mismatch' ? 'pill-error' : c.category === 'missing' ? 'pill-warning' : ''}`}>{c.category}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Date mismatch tolerance (seconds)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={s.issues.toleranceSeconds}
              onChange={(e) => set('issues', { ...s.issues, toleranceSeconds: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>
        </div>
      </section>

      <section className="section">
        <span className="eyebrow">Trash</span>
        <div className="card stack">
          <div className="field" style={{ maxWidth: 360 }}>
            <label>Delete trashed files after (days)</label>
            <input
              className="input"
              type="number"
              min={0}
              placeholder={`Config default: ${config?.trashRetentionDays ?? 30}`}
              value={s.trash.retentionDays ?? ''}
              onChange={(e) => set('trash', { retentionDays: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })}
            />
            <span className="hint">Empty uses the value from the config. 0 keeps files until you empty the trash.</span>
          </div>
        </div>
      </section>

      <StaticConfig />
    </div>
  );
}

function StaticConfig() {
  const { data } = useQuery({ queryKey: ['staticConfig'], queryFn: () => api<unknown>('/api/config/static') });
  return (
    <section className="section">
      <span className="eyebrow">Static configuration (read-only)</span>
      <div className="card stack">
        <p className="muted caption" style={{ margin: 0 }}>
          From the APP_CONFIG environment variable merged over /app/config.yaml. Change it in your compose file and restart the container.
        </p>
        <pre className="code">{data ? JSON.stringify(data, null, 2) : '…'}</pre>
      </div>
    </section>
  );
}
