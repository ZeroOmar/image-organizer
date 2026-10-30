import { formatIsoLocal, isValidZone, parseIsoLocal, type EnrichedEntry, type Selection, type Step } from '@io/shared';
import { useMemo, useState } from 'react';
import { useConfig } from '../../api/hooks';
import { ActionDialog } from '../../components/ActionDialog';

type Mode = 'apply' | 'shift' | 'set' | 'tz';

export const TIMEZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

export function TimezoneInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <>
      <input id={id} className="input" list="tz-list" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Africa/Cairo or +03:00" />
      <datalist id="tz-list">
        {TIMEZONES.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}

export function DatesDialog({ selection, focused, onClose }: { selection: Selection; focused: EnrichedEntry | null; onClose: () => void }) {
  const defaultTz = useConfig().data?.defaultTimezone ?? 'UTC';
  const [mode, setMode] = useState<Mode>('apply');
  const [shift, setShift] = useState({ sign: 1, d: 0, h: 0, m: 0, s: 0 });
  const [local, setLocal] = useState(focused?.resolved ? formatIsoLocal(focused.resolved.local) : '');
  const [tz, setTz] = useState(focused?.resolved?.tz ?? defaultTz);
  const [keep, setKeep] = useState<'wall' | 'instant'>('wall');

  const { steps, invalid } = useMemo((): { steps: Step[] | null; invalid: string | null } => {
    if (mode === 'apply') return { steps: [{ type: 'applyDates' }], invalid: null };
    if (mode === 'shift') {
      const seconds = shift.sign * (shift.d * 86400 + shift.h * 3600 + shift.m * 60 + shift.s);
      return seconds ? { steps: [{ type: 'shiftDates', seconds }], invalid: null } : { steps: null, invalid: 'Enter an amount to shift' };
    }
    if (!isValidZone(tz)) return { steps: null, invalid: 'Unknown timezone' };
    if (mode === 'set') {
      return parseIsoLocal(local) ? { steps: [{ type: 'setDate', local, tz }], invalid: null } : { steps: null, invalid: 'Enter a date and time' };
    }
    return { steps: [{ type: 'setTimezone', tz, keep }], invalid: null };
  }, [mode, shift, local, tz, keep]);

  const num = (k: 'd' | 'h' | 'm' | 's', label: string) => (
    <div className="field" style={{ width: 90 }}>
      <label>{label}</label>
      <input className="input" type="number" min={0} value={shift[k]} onChange={(e) => setShift({ ...shift, [k]: Math.max(0, Number(e.target.value) || 0) })} />
    </div>
  );

  return (
    <ActionDialog title="Dates & timezone" eyebrow="Batch action" selection={selection} steps={steps} invalid={invalid} onClose={onClose}>
      <div className="stack" style={{ gap: 10 }}>
        <label className="check">
          <input type="radio" checked={mode === 'apply'} onChange={() => setMode('apply')} />
          <span>
            <strong>Write resolved date</strong>
            <span className="muted"> — store the date shown on each tile (from your date-source priority) and its UTC offset into the file. Fixes stripped social-media copies.</span>
          </span>
        </label>
        <label className="check">
          <input type="radio" checked={mode === 'shift'} onChange={() => setMode('shift')} />
          <span>
            <strong>Shift time</strong>
            <span className="muted"> — camera clock was off by a fixed amount.</span>
          </span>
        </label>
        <label className="check">
          <input type="radio" checked={mode === 'set'} onChange={() => setMode('set')} />
          <span>
            <strong>Set exact date</strong>
            <span className="muted"> — same date/time on every selected file.</span>
          </span>
        </label>
        <label className="check">
          <input type="radio" checked={mode === 'tz'} onChange={() => setMode('tz')} />
          <span>
            <strong>Set timezone</strong>
            <span className="muted"> — the photos were taken in a different zone.</span>
          </span>
        </label>
      </div>

      {mode === 'shift' && (
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 120 }}>
            <label>Direction</label>
            <select className="input" value={shift.sign} onChange={(e) => setShift({ ...shift, sign: Number(e.target.value) })}>
              <option value={1}>Forward +</option>
              <option value={-1}>Back −</option>
            </select>
          </div>
          {num('d', 'Days')}
          {num('h', 'Hours')}
          {num('m', 'Minutes')}
          {num('s', 'Seconds')}
        </div>
      )}
      {mode === 'set' && (
        <div className="grid-2">
          <div className="field">
            <label>Local date & time</label>
            <input className="input" type="datetime-local" step={1} value={local} onChange={(e) => setLocal(e.target.value)} />
          </div>
          <div className="field">
            <label>Timezone</label>
            <TimezoneInput value={tz} onChange={setTz} />
          </div>
        </div>
      )}
      {mode === 'tz' && (
        <div className="stack">
          <div className="field">
            <label>Timezone</label>
            <TimezoneInput value={tz} onChange={setTz} />
          </div>
          <label className="check">
            <input type="radio" checked={keep === 'wall'} onChange={() => setKeep('wall')} />
            <span>
              Keep the clock time <span className="muted">(14:13 stays 14:13, the UTC instant changes) — usual when the camera was set to local time.</span>
            </span>
          </label>
          <label className="check">
            <input type="radio" checked={keep === 'instant'} onChange={() => setKeep('instant')} />
            <span>
              Keep the instant <span className="muted">(convert the clock time into the new zone).</span>
            </span>
          </label>
        </div>
      )}
    </ActionDialog>
  );
}
