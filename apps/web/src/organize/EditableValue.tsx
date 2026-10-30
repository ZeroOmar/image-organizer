import { useEffect, useRef, useState, type ReactNode } from 'react';

export type TagWrite = string | number | string[] | null;

/**
 * A metadata value that turns into an input on click. Enter saves, Escape cancels.
 * Saving an empty value deletes the tag. `validate` returns an error message or null.
 */
export function EditableValue({
  display,
  initial,
  list,
  numeric,
  placeholder,
  validate,
  onSave,
  className,
}: {
  display: ReactNode;
  /** Text the input starts with. */
  initial: string;
  /** Comma-separated list (e.g. keywords) → written as an array. */
  list?: boolean;
  numeric?: boolean;
  placeholder?: string;
  validate?: (v: string) => string | null;
  onSave: (value: TagWrite) => Promise<void>;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setValue(initial);
  }, [initial, editing]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const save = async () => {
    const v = value.trim();
    if (v === initial.trim()) return setEditing(false);
    const err = v ? (validate?.(v) ?? null) : null;
    if (err) return setError(err);
    setBusy(true);
    try {
      const out: TagWrite = !v
        ? null
        : list
          ? v
              .split(/[,;]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : numeric
            ? Number(v)
            : v;
      await onSave(out);
      setEditing(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <dd className={`editable ${className ?? ''}`} onClick={() => setEditing(true)} title="Click to edit">
        {display}
      </dd>
    );
  }
  return (
    <dd className="editing">
      <input
        ref={input}
        className="input input-inline"
        value={value}
        disabled={busy}
        placeholder={placeholder ?? 'empty deletes the tag'}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
            setError(null);
          }
        }}
        onBlur={() => !busy && !error && value.trim() === initial.trim() && setEditing(false)}
      />
      <div className="row" style={{ gap: 6, marginTop: 4 }}>
        <button className="btn btn-primary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
      {error && <div className="error-text caption">{error}</div>}
    </dd>
  );
}

export const EXIF_DATE = /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/;
export const validateExifDate = (v: string) => (EXIF_DATE.test(v) ? null : 'Use YYYY:MM:DD HH:MM:SS');
export const validateOffset = (v: string) => (/^[+-]\d{2}:\d{2}$/.test(v) ? null : 'Use +HH:MM or -HH:MM');
export const validateRating = (v: string) => (/^[0-5]$/.test(v) ? null : 'Rating is 0–5');
