import { DATE_SOURCES, formatDisplay, utcMsToWall, type EnrichedEntry, type IssueCheckId } from '@io/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { useMetadata } from '../api/hooks';
import { EditableValue, validateExifDate, validateOffset, validateRating, type TagWrite } from './EditableValue';

const sourceLabel = Object.fromEntries(DATE_SOURCES.map((s) => [s.id, s.label]));
const fmtSize = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${Math.ceil(n / 1e3)} KB`);

/** Family-1 groups ExifTool can't write (or that we change through other actions, like FileName). */
const READ_ONLY_GROUPS = new Set(['Composite', 'File', 'System', 'ExifTool']);

export interface MetadataEditing {
  /** Write one tag to the edit targets (the selection when it includes this file, else this file). */
  onEditTag: (tag: string, value: TagWrite) => Promise<void>;
  onEditGps: () => void;
  /** How many files an edit applies to. */
  targets: number;
}

export function MetadataPanel({ entry, tab, editing }: { entry: EnrichedEntry | null; tab: 'summary' | 'all'; editing?: MetadataEditing }) {
  if (!entry) return <div className="empty">No file selected.</div>;
  return (
    <>
      {editing && (
        <div className="edit-hint">
          Click a value to edit it{editing.targets > 1 ? ` — applies to all ${editing.targets} selected files` : ''}. Changes can be undone from the Jobs menu (top right).
        </div>
      )}
      {tab === 'summary' ? <Summary e={entry} editing={editing} /> : <AllTags e={entry} editing={editing} />}
    </>
  );
}

function Summary({ e, editing }: { e: EnrichedEntry; editing?: MetadataEditing }) {
  const has = (...ids: IssueCheckId[]) => e.issues.find((i) => ids.includes(i.id));
  const cls = (...ids: IssueCheckId[]) => {
    const i = has(...ids);
    return i ? (i.category === 'mismatch' ? 'err' : 'warn') : undefined;
  };
  const r = e.resolved;
  const m = e.meta;
  const row = (k: string, v: ReactNode, c?: string) =>
    v === undefined || v === null || v === '' ? null : (
      <>
        <dt title={k}>{k}</dt>
        <dd className={c}>{v}</dd>
      </>
    );
  /** An editable row; shown even when empty so missing tags can be filled in. Read-only without `editing`. */
  const edit = (
    k: string,
    tag: string,
    raw: string | number | string[] | undefined,
    opts: { c?: string; list?: boolean; numeric?: boolean; placeholder?: string; validate?: (v: string) => string | null; trim19?: boolean } = {},
  ) => {
    const text = raw === undefined ? '' : Array.isArray(raw) ? raw.join(', ') : String(raw);
    const initial = opts.trim19 ? text.slice(0, 19) : text;
    if (!editing) return row(k, text || '—', opts.c);
    return (
      <>
        <dt title={`${k} (${tag})`}>{k}</dt>
        <EditableValue
          display={text || '—'}
          initial={initial}
          list={opts.list}
          numeric={opts.numeric}
          placeholder={opts.placeholder}
          validate={opts.validate}
          className={opts.c}
          onSave={(v) => editing.onEditTag(tag, v)}
        />
      </>
    );
  };

  return (
    <div>
      {e.issues.length > 0 && (
        <div className="meta-section">
          <h4 className="eyebrow">Issues</h4>
          <ul className="issue-list">
            {e.issues.map((i) => (
              <li key={i.id} className={i.category === 'mismatch' ? 'error-text' : i.category === 'missing' ? 'warning-text' : 'muted'}>
                • {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="meta-section">
        <h4 className="eyebrow">Dates</h4>
        <dl className="kv">
          {row(
            'Resolved',
            r ? `${formatDisplay(r.local)} ${r.offset}` : 'No date found',
            r ? cls('dateMismatchFile', 'dateMismatchFilename') : 'warn',
          )}
          {r && row('Source', `${sourceLabel[r.source]}${r.timeFrom ? ` (time from ${sourceLabel[r.timeFrom]})` : ''}${r.dateOnly ? ' — date only' : ''}`)}
          {r && row('Timezone', `${r.tz} · from ${{ offset: 'file offset', gps: 'GPS', default: 'default' }[r.tzSource]}`, cls('missingOffset'))}
          {r && row('UTC', formatDisplay(utcMsToWall(r.utcMs)))}
          {e.kind === 'photo' ? (
            <>
              {edit('Date Time Original', 'DateTimeOriginal', m.dateTimeOriginal, {
                c: cls('missingOriginalDate'),
                validate: validateExifDate,
                placeholder: 'YYYY:MM:DD HH:MM:SS',
                trim19: true,
              })}
              {edit('Offset Time Original', 'OffsetTimeOriginal', m.offsetTimeOriginal, { c: cls('missingOffset'), validate: validateOffset, placeholder: '+03:00' })}
              {edit('Create Date', 'CreateDate', m.createDate, { validate: validateExifDate, placeholder: 'YYYY:MM:DD HH:MM:SS', trim19: true })}
            </>
          ) : (
            <>
              {edit('QuickTime Create (UTC)', 'QuickTime:CreateDate', m.qtCreateDate, {
                c: cls('missingOriginalDate'),
                validate: validateExifDate,
                placeholder: 'YYYY:MM:DD HH:MM:SS (UTC)',
                trim19: true,
              })}
              {edit('Creation Date (local)', 'Keys:CreationDate', m.qtCreationDate, { placeholder: 'YYYY:MM:DD HH:MM:SS+03:00' })}
            </>
          )}
          {row('File Modified', new Date(e.mtimeMs).toLocaleString(), cls('dateMismatchFile'))}
        </dl>
      </div>
      <div className="meta-section">
        <h4 className="row eyebrow" style={{ justifyContent: 'space-between' }}>
          <span>GPS</span>
          {editing && (
            <button className="btn btn-ghost btn-sm" onClick={editing.onEditGps}>
              {m.gps ? 'Edit on map' : 'Add location'}
            </button>
          )}
        </h4>
        <dl className="kv">
          {m.gps ? (
            <>
              {row('Latitude', m.gps.lat.toFixed(6))}
              {row('Longitude', m.gps.lon.toFixed(6))}
              {row('Altitude', m.gps.alt != null ? `${m.gps.alt.toFixed(1)} m` : undefined)}
              {row('Zone', e.gpsTz ?? undefined)}
            </>
          ) : (
            row('Position', 'None', cls('missingGps'))
          )}
        </dl>
      </div>
      <div className="meta-section">
        <h4 className="eyebrow">Camera</h4>
        <dl className="kv">
          {edit('Make', 'Make', m.make, { c: cls('missingCamera') })}
          {edit('Model', 'Model', m.model, { c: cls('missingCamera') })}
          {edit('Lens', 'LensModel', m.lens)}
          {row('Aperture', m.fNumber ? `f/${m.fNumber}` : undefined)}
          {row('Exposure', m.exposureTime ? (m.exposureTime >= 1 ? `${m.exposureTime} s` : `1/${Math.round(1 / m.exposureTime)}`) : undefined)}
          {row('ISO', m.iso)}
          {row('Focal Length', m.focalLength ? `${m.focalLength} mm` : undefined)}
          {row('Focal Length 35mm', m.focalLength35 ? `${m.focalLength35} mm` : undefined)}
        </dl>
      </div>
      <div className="meta-section">
        <h4 className="eyebrow">File</h4>
        <dl className="kv">
          {row('Name', e.name, cls('nameOffTemplate'))}
          {row('Folder', `${e.root}/${e.rel.split('/').slice(0, -1).join('/')}`)}
          {row('Size', fmtSize(e.size))}
          {row('Dimensions', m.width && m.height ? `${m.width} × ${m.height}` : undefined)}
          {row('Duration', m.duration ? `${m.duration.toFixed(1)} s` : undefined)}
          {edit('Rating', 'XMP:Rating', m.rating, { numeric: true, validate: validateRating, placeholder: '0–5' })}
          {edit('Keywords', 'XMP:Subject', m.keywords, { list: true, placeholder: 'comma separated' })}
        </dl>
        {e.metaError && <p className="error-text caption">{e.metaError}</p>}
      </div>
    </div>
  );
}

function AllTags({ e, editing }: { e: EnrichedEntry; editing?: MetadataEditing }) {
  const { data, isLoading, error } = useMetadata(e.root, e.rel);
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return Object.entries(data)
      .map(([g, tags]) => [g, Object.entries(tags).filter(([k, v]) => !needle || k.toLowerCase().includes(needle) || String(v).toLowerCase().includes(needle))] as const)
      .filter(([, tags]) => tags.length);
  }, [data, q]);
  return (
    <div>
      <div style={{ padding: 8, position: 'sticky', top: 0, background: 'var(--canvas)', zIndex: 1 }}>
        <input className="input" placeholder="Filter tags…" value={q} onChange={(ev) => setQ(ev.target.value)} />
      </div>
      {isLoading && <div className="empty">Reading…</div>}
      {error && <div className="error-text" style={{ padding: 12 }}>{(error as Error).message}</div>}
      {groups.map(([g, tags]) => {
        const writable = !!editing && !READ_ONLY_GROUPS.has(g);
        return (
          <details className="meta-section" key={g} open={groups.length < 6 || !!q}>
            <summary className="eyebrow" style={{ cursor: 'pointer' }}>
              {g} <span className="subtle">({tags.length}{editing && !writable ? ', read-only' : ''})</span>
            </summary>
            <dl className="kv" style={{ marginTop: 6 }}>
              {tags.map(([k, v]) => {
                const text = Array.isArray(v) ? v.join(', ') : String(v);
                return (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt title={`${g}:${k}`}>{k}</dt>
                    {writable ? (
                      <EditableValue display={text} initial={text} list={Array.isArray(v)} onSave={(val) => editing!.onEditTag(`${g}:${k}`, val)} />
                    ) : (
                      <dd>{text}</dd>
                    )}
                  </div>
                );
              })}
            </dl>
          </details>
        );
      })}
    </div>
  );
}
