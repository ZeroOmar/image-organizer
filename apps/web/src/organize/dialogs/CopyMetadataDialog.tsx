import { COPY_GROUPS, type CopyGroup, type EnrichedEntry, type FileRef } from '@io/shared';
import { useMemo, useState } from 'react';
import { ActionDialog } from '../../components/ActionDialog';

const GROUPS = Object.entries(COPY_GROUPS) as [CopyGroup, (typeof COPY_GROUPS)[CopyGroup]][];
/** Dates and GPS are converted per file type on the server, so they're all-or-nothing. */
const WHOLE: CopyGroup[] = ['dates', 'gps'];

export function CopyMetadataDialog({
  selection,
  entries,
  focused,
  onClose,
}: {
  selection: { files: FileRef[] };
  entries: EnrichedEntry[];
  focused: EnrichedEntry | null;
  onClose: () => void;
}) {
  const [source, setSource] = useState(focused?.rel ?? entries[0]?.rel ?? '');
  const [checked, setChecked] = useState<Set<string>>(new Set(['dates:*', 'gps:*']));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState('');

  const groupKey = (g: CopyGroup) => `${g}:*`;
  const isOn = (g: CopyGroup, tag?: string) => checked.has(groupKey(g)) || (tag ? checked.has(`${g}:${tag}`) : false);
  const toggle = (key: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const toggleGroup = (g: CopyGroup) =>
    setChecked((s) => {
      const n = new Set([...s].filter((k) => !k.startsWith(`${g}:`)));
      if (!s.has(groupKey(g))) n.add(groupKey(g));
      return n;
    });

  const srcEntry = entries.find((e) => e.rel === source);
  const targets = selection.files.filter((f) => f.rel !== source);
  const { groups, tags } = useMemo(() => {
    const groups: string[] = [];
    const tags: string[] = [];
    for (const [g, def] of GROUPS) {
      if (WHOLE.includes(g)) {
        if (checked.has(groupKey(g))) groups.push(g);
      } else if (checked.has(groupKey(g))) tags.push(...def.tags);
      else tags.push(...def.tags.filter((t) => checked.has(`${g}:${t}`)));
    }
    tags.push(
      ...custom
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    );
    return { groups, tags };
  }, [checked, custom]);

  const invalid = !srcEntry ? 'Choose a source file' : !targets.length ? 'Select at least one other file to copy to' : !groups.length && !tags.length ? 'Choose what to copy' : null;

  return (
    <ActionDialog
      title="Copy metadata"
      eyebrow={`From 1 file to ${targets.length}`}
      selection={{ files: targets }}
      steps={srcEntry ? [{ type: 'copyMetadata', source: { root: srcEntry.root, rel: srcEntry.rel }, groups, tags }] : null}
      invalid={invalid}
      onClose={onClose}
    >
      <div className="field">
        <label>Source file</label>
        <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
          {entries.map((e) => (
            <option key={e.rel} value={e.rel}>
              {e.name}
              {e.meta.make ? ` — ${e.meta.make} ${e.meta.model ?? ''}` : ''}
            </option>
          ))}
        </select>
        <span className="hint">The source is excluded from the targets. Tip: click the source last so it becomes the focused file.</span>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">What to copy</span>
        {GROUPS.map(([g, def]) => {
          const whole = WHOLE.includes(g);
          const someOn = def.tags.some((t) => checked.has(`${g}:${t}`));
          return (
            <div key={g} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <label className="check grow">
                  <input
                    type="checkbox"
                    checked={checked.has(groupKey(g))}
                    ref={(el) => {
                      if (el) el.indeterminate = !checked.has(groupKey(g)) && someOn;
                    }}
                    onChange={() => toggleGroup(g)}
                  />
                  <strong>{def.label}</strong>
                </label>
                {!whole && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      setOpen((s) => {
                        const n = new Set(s);
                        if (n.has(g)) n.delete(g);
                        else n.add(g);
                        return n;
                      })
                    }
                  >
                    {open.has(g) ? 'Hide tags' : 'Pick tags'}
                  </button>
                )}
              </div>
              {whole && <span className="caption muted">{g === 'dates' ? 'Capture date + offset, converted for photos (EXIF) and videos (QuickTime UTC).' : 'Latitude, longitude and altitude.'}</span>}
              {!whole && open.has(g) && (
                <div className="row" style={{ paddingLeft: 24 }}>
                  {def.tags.map((t) => (
                    <label className="check caption" key={t}>
                      <input type="checkbox" checked={isOn(g, t)} disabled={checked.has(groupKey(g))} onChange={() => toggle(`${g}:${t}`)} />
                      <span className="mono">{t}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="field">
        <label>Other tags (optional)</label>
        <input className="input mono" placeholder="e.g. XMP:Label, Software" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <span className="hint">ExifTool tag names, comma separated.</span>
      </div>
    </ActionDialog>
  );
}
