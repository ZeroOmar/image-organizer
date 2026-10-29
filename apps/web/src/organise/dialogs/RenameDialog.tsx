import { TEMPLATE_TOKENS, parseTemplate, previewTemplate, type Selection } from '@io/shared';
import { useRef, useState } from 'react';
import { useSettings } from '../../api/hooks';
import { ActionDialog } from '../../components/ActionDialog';

/** Token palette that inserts at the cursor of the last focused template input. */
export function TokenPalette({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {TEMPLATE_TOKENS.map((t) => (
        <button key={t.token} type="button" className="chip" title={`${t.description} — e.g. ${t.example}`} onClick={() => onInsert(`{${t.token}}`)}>
          {`{${t.token}}`}
        </button>
      ))}
    </div>
  );
}

export function useTemplateInput(initial: string) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const insert = (text: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };
  return { value, setValue, ref, insert };
}

export function RenameDialog({ selection, onClose }: { selection: Selection; onClose: () => void }) {
  const settings = useSettings().data;
  if (!settings) return null;
  return <RenameForm selection={selection} onClose={onClose} photo={settings.rename.templates.photo} video={settings.rename.templates.video} />;
}

function RenameForm({ selection, onClose, photo, video }: { selection: Selection; onClose: () => void; photo: string; video: string }) {
  const settings = useSettings().data!;
  const p = useTemplateInput(photo);
  const v = useTemplateInput(video);
  const [last, setLast] = useState<'p' | 'v'>('p');
  const errors = [...parseTemplate(p.value).errors.map((e) => `Photo: ${e}`), ...parseTemplate(v.value).errors.map((e) => `Video: ${e}`)];
  const custom = p.value !== photo || v.value !== video;
  return (
    <ActionDialog
      title="Rename by template"
      eyebrow="Batch action"
      selection={selection}
      steps={[{ type: 'rename', templates: custom ? { photo: p.value, video: v.value } : undefined }]}
      invalid={errors[0] ?? null}
      onClose={onClose}
    >
      <p className="muted" style={{ margin: 0 }}>
        Names come from each file’s resolved capture date in its timezone. Files that land on the same name are numbered
        from {String(settings.rename.counter.start).padStart(settings.rename.counter.digits, '0')} through <span className="mono">{'{XX}'}</span>.
        Change the defaults in Settings; edits here apply to this run only.
      </p>
      <div className="field">
        <label>Photo template</label>
        <input ref={p.ref} className="input mono" value={p.value} onChange={(e) => p.setValue(e.target.value)} onFocus={() => setLast('p')} />
        <span className="hint mono">
          {previewTemplate(p.value, 'photo', settings)} · {previewTemplate(p.value, 'photo', settings, '01')}
        </span>
      </div>
      <div className="field">
        <label>Video template</label>
        <input ref={v.ref} className="input mono" value={v.value} onChange={(e) => v.setValue(e.target.value)} onFocus={() => setLast('v')} />
        <span className="hint mono">{previewTemplate(v.value, 'video', settings)}</span>
      </div>
      <TokenPalette onInsert={(t) => (last === 'p' ? p.insert(t) : v.insert(t))} />
      {errors.map((e) => (
        <div key={e} className="warning-text caption">
          {e}
        </div>
      ))}
    </ActionDialog>
  );
}
