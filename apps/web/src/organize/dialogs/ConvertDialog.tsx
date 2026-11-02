import { CONVERT_PRESETS, type ConvertPreset, type Selection } from '@io/shared';
import { useState } from 'react';
import { useSettings } from '../../api/hooks';
import { ActionDialog } from '../../components/ActionDialog';

const QUALITY = [
  { crf: 20, label: 'High quality', hint: 'Near-original detail, about 3–5× smaller' },
  { crf: 24, label: 'Balanced', hint: 'Visually close to the original, about 5–10× smaller' },
  { crf: 28, label: 'Small', hint: 'Smallest files, some softness in fine detail and motion' },
];

/** Re-encode the selected videos to HEVC. CRF/preset default to Settings → Video conversion. */
export function ConvertDialog({ selection, count, onClose }: { selection: Selection; count: number; onClose: () => void }) {
  const c = useSettings().data?.convert;
  const [crf, setCrf] = useState<number | null>(null);
  const [preset, setPreset] = useState<ConvertPreset | null>(null);
  const crfV = crf ?? c?.crf ?? 24;
  const presetV = preset ?? c?.preset ?? 'medium';
  return (
    <ActionDialog
      title={`Convert ${count} video${count === 1 ? '' : 's'} to HEVC`}
      eyebrow="Batch action"
      selection={selection}
      steps={[{ type: 'convert', crf: crfV, preset: presetV }]}
      applyLabel="Convert"
      onClose={onClose}
    >
      <p className="muted" style={{ margin: 0 }}>
        Re-encodes with H.265 (libx265) at the same resolution. Audio, dates, timezone, GPS and camera make/model are kept. Each original goes to
        the trash, so Undo works until the trash is emptied.
      </p>
      <div className="field">
        <label>Quality</label>
        <div className="seg" role="radiogroup" aria-label="Quality">
          {QUALITY.map((q) => (
            <button key={q.crf} className={crfV === q.crf ? 'active' : ''} onClick={() => setCrf(q.crf)} title={q.hint}>
              {q.label}
            </button>
          ))}
        </div>
        <label className="row" style={{ gap: 8 }}>
          <span className="caption muted">CRF</span>
          <input type="range" className="grow" min={16} max={32} value={crfV} onChange={(e) => setCrf(Number(e.target.value))} aria-label="CRF" />
          <span className="mono">{crfV}</span>
        </label>
        <span className="hint">{QUALITY.find((q) => q.crf === crfV)?.hint ?? 'Lower = better quality and bigger files.'}</span>
      </div>
      <div className="field" style={{ maxWidth: 260 }}>
        <label>Encoder speed</label>
        <select className="input" value={presetV} onChange={(e) => setPreset(e.target.value as ConvertPreset)}>
          {CONVERT_PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span className="hint">Slower presets give smaller files at the same quality.</span>
      </div>
      {c && (
        <p className="caption subtle" style={{ margin: 0 }}>
          Skipped automatically: videos already in {c.skipCodecs.map((x) => x.toUpperCase()).join('/') || 'no codec'}, under {c.minBitrateMbps} Mbps, or
          whose result isn't at least {c.minSavingPct}% smaller (change these in Settings). Encoding is slow: expect about real time or slower for 1080p.
          Progress and Cancel are in the Jobs menu.
        </p>
      )}
    </ActionDialog>
  );
}
