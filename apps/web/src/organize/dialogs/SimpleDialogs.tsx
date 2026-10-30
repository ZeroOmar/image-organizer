import type { EnrichedEntry, RootName, Selection, Step } from '@io/shared';
import { useMemo, useState } from 'react';
import { ActionDialog } from '../../components/ActionDialog';
import { FolderPicker } from '../../components/FolderPicker';

const ROOT_LABEL: Record<RootName, string> = { media: 'media', import: 'import', trash: 'trash' };

export function MoveDialog({ selection, root, current, onClose }: { selection: Selection; root: RootName; current: string; onClose: () => void }) {
  const [dest, setDest] = useState(current);
  return (
    <ActionDialog
      title="Move files"
      eyebrow="Batch action"
      selection={selection}
      steps={[{ type: 'move', dest: { root, rel: dest } }]}
      invalid={dest === current ? 'Choose a different folder' : null}
      onClose={onClose}
    >
      <FolderPicker root={root} value={dest} onChange={setDest} rootLabel={ROOT_LABEL[root]} />
      <p className="caption muted">Name collisions in the destination get a _1, _2 … suffix; nothing is overwritten.</p>
    </ActionDialog>
  );
}

export function TrashDialog({ selection, count, onClose }: { selection: Selection; count: number; onClose: () => void }) {
  return (
    <ActionDialog title={`Move ${count} file${count === 1 ? '' : 's'} to the trash`} eyebrow="Batch action" selection={selection} steps={[{ type: 'trash' }]} onClose={onClose} applyLabel="Move to trash">
      <p className="muted" style={{ margin: 0 }}>
        Files go to the separate /trash mount and can be restored from the Trash page (or with Undo).
      </p>
    </ActionDialog>
  );
}

export function SyncDatesDialog({ selection, onClose }: { selection: Selection; onClose: () => void }) {
  return (
    <ActionDialog title="Sync file dates" eyebrow="Batch action" selection={selection} steps={[{ type: 'syncFileDates' }]} onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>
        Sets each file’s modified date to its resolved capture date, so file browsers sort correctly. Metadata isn’t changed.
      </p>
    </ActionDialog>
  );
}

const COMMON_TAGS = [
  { tag: 'XMP:Title', label: 'Title' },
  { tag: 'XMP:Description', label: 'Description' },
  { tag: 'XMP:Subject', label: 'Keywords', list: true },
  { tag: 'XMP:Rating', label: 'Rating (0–5)' },
  { tag: 'Make', label: 'Camera make' },
  { tag: 'Model', label: 'Camera model' },
  { tag: 'Artist', label: 'Artist' },
  { tag: 'Copyright', label: 'Copyright' },
];

/** Write common or arbitrary tags. Only fields you touch are written; "delete" removes a tag. */
export function EditTagsDialog({ selection, focused, onClose }: { selection: Selection; focused: EnrichedEntry | null; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [del, setDel] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<{ tag: string; value: string }[]>([]);

  const steps = useMemo((): Step[] | null => {
    const tags: Record<string, string | number | string[] | null> = {};
    for (const t of COMMON_TAGS) {
      if (del.has(t.tag)) tags[t.tag] = null;
      else if (values[t.tag] !== undefined && values[t.tag] !== '') {
        const v = values[t.tag];
        tags[t.tag] = t.list
          ? v
              .split(/[,;]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : t.tag === 'XMP:Rating'
            ? Number(v)
            : v;
      }
    }
    for (const c of custom) if (c.tag.trim()) tags[c.tag.trim()] = c.value === '' ? null : c.value;
    return Object.keys(tags).length ? [{ type: 'editTags', tags }] : null;
  }, [values, del, custom]);

  const rating = values['XMP:Rating'];
  const invalid = rating && !/^[0-5]$/.test(rating) ? 'Rating must be 0–5' : !steps ? 'Change at least one field' : null;

  return (
    <ActionDialog title="Edit tags" eyebrow="Batch action" selection={selection} steps={steps} invalid={invalid} onClose={onClose}>
      <p className="caption muted" style={{ margin: 0 }}>
        Empty fields are left untouched.{' '}
        {focused?.meta.keywords?.length ? (
          <>
            Current keywords on {focused.name}: <span className="mono">{focused.meta.keywords.join(', ')}</span>
          </>
        ) : null}
      </p>
      <div className="grid-2">
        {COMMON_TAGS.map((t) => (
          <div className="field" key={t.tag}>
            <label className="row" style={{ justifyContent: 'space-between' }}>
              <span>{t.label}</span>
              <span className="check caption">
                <input
                  type="checkbox"
                  checked={del.has(t.tag)}
                  onChange={() =>
                    setDel((s) => {
                      const n = new Set(s);
                      if (n.has(t.tag)) n.delete(t.tag);
                      else n.add(t.tag);
                      return n;
                    })
                  }
                />
                delete
              </span>
            </label>
            <input
              className="input"
              disabled={del.has(t.tag)}
              value={values[t.tag] ?? ''}
              placeholder={t.list ? 'comma separated' : ''}
              onChange={(e) => setValues({ ...values, [t.tag]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Other tags</span>
        {custom.map((c, i) => (
          <div className="row" key={i}>
            <input
              className="input mono"
              style={{ width: 220 }}
              placeholder="Group:Tag"
              value={c.tag}
              onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, tag: e.target.value } : x)))}
            />
            <input
              className="input grow"
              placeholder="value (empty = delete)"
              value={c.value}
              onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            />
            <button className="btn btn-ghost icon-btn" onClick={() => setCustom(custom.filter((_, j) => j !== i))} aria-label="Remove">
              ✕
            </button>
          </div>
        ))}
        <div>
          <button className="btn btn-sm" onClick={() => setCustom([...custom, { tag: '', value: '' }])}>
            + Add tag
          </button>
        </div>
      </div>
    </ActionDialog>
  );
}
