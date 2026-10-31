import { COPY_GROUPS, type CopyGroup, type EnrichedEntry, type FileRef } from '@io/shared';
import { useMemo, useState } from 'react';
import { thumbUrl } from '../../api/client';
import { useMetadataMany, type TagGroups } from '../../api/hooks';
import { ActionDialog } from '../../components/ActionDialog';

const GROUPS = Object.entries(COPY_GROUPS) as [CopyGroup, (typeof COPY_GROUPS)[CopyGroup]][];
/** Dates and GPS are converted per file type on the server, so they're all-or-nothing. */
const WHOLE: CopyGroup[] = ['dates', 'gps'];
/** Fetching all tags costs one ExifTool read per file, so the comparison stops here. */
const MAX_ROWS = 50;

/**
 * Find a tag in `/api/metadata` output (family-1 groups). "XMP:Title" matches groups XMP and XMP-*;
 * a bare name takes the first writable group that has it, falling back to Composite (e.g. signed GPS).
 */
function lookup(data: TagGroups | undefined, tag: string): unknown {
  if (!data) return undefined;
  const i = tag.indexOf(':');
  const [prefix, name] = i > 0 ? [tag.slice(0, i), tag.slice(i + 1)] : [null, tag];
  const groups = Object.keys(data).filter((g) => !prefix || g === prefix || g.startsWith(`${prefix}-`));
  groups.sort((a, b) => Number(a === 'Composite') - Number(b === 'Composite'));
  for (const g of groups) if (data[g][name] !== undefined) return data[g][name];
  return undefined;
}

const show = (v: unknown) => (v === undefined || v === null || v === '' ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

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

  // Comparison columns: every tag that will be copied (whole groups list their tags too).
  const columns = useMemo(() => {
    const cols: string[] = [];
    for (const [g, def] of GROUPS) if (groups.includes(g)) cols.push(...def.tags);
    return [...new Set([...cols, ...tags])];
  }, [groups, tags]);
  const rows = entries.slice(0, MAX_ROWS);
  const meta = useMetadataMany(rows);
  const srcIndex = rows.findIndex((e) => e.rel === source);
  const srcValues = columns.map((t) => show(lookup(meta[srcIndex]?.data, t)));

  const invalid = !srcEntry ? 'Choose a source file' : !targets.length ? 'Select at least one other file to copy to' : !groups.length && !tags.length ? 'Choose what to copy' : null;

  return (
    <ActionDialog
      title="Copy metadata"
      eyebrow={`From 1 file to ${targets.length}`}
      selection={{ files: targets }}
      steps={srcEntry ? [{ type: 'copyMetadata', source: { root: srcEntry.root, rel: srcEntry.rel }, groups, tags }] : null}
      invalid={invalid}
      onClose={onClose}
      wide
    >
      <div className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Source file</span>
        <div className="table-wrap" style={{ maxHeight: 340 }}>
          <table className="table compare-table">
            <thead>
              <tr>
                <th>File</th>
                {columns.map((t) => (
                  <th key={t} title={t}>
                    {t.replace(/^[^:]+:/, '')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e, r) => {
                const isSrc = e.rel === source;
                const q = meta[r];
                return (
                  <tr key={e.rel} className={isSrc ? 'source' : ''} onClick={() => setSource(e.rel)}>
                    <td>
                      <label className="compare-file">
                        <input type="radio" name="copy-source" checked={isSrc} onChange={() => setSource(e.rel)} />
                        <img src={thumbUrl(e, 320)} alt="" loading="lazy" />
                        <span>
                          <span className="compare-name">{e.name}</span>
                          <span className="caption muted">{isSrc ? 'Source' : 'Target'}</span>
                        </span>
                      </label>
                    </td>
                    {columns.map((t, c) => {
                      if (q?.isLoading) return <td key={t} className="muted">…</td>;
                      if (q?.error) return <td key={t} className="error-text">error</td>;
                      const v = show(lookup(q?.data, t));
                      // On targets, mark what the copy will change.
                      const changes = !isSrc && srcIndex >= 0 && v !== srcValues[c];
                      return (
                        <td key={t} className={changes ? 'changes' : isSrc ? '' : 'muted'}>
                          {v || <span className="subtle">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <span className="hint caption muted">
          Click a row to make it the source; every other selected file is a target. Highlighted cells will change.
          {entries.length > MAX_ROWS && ` Showing the first ${MAX_ROWS} of ${entries.length} files.`}
        </span>
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
