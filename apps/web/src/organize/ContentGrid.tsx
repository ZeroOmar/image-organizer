import { formatDisplay, type EnrichedEntry } from '@io/shared';
import { memo, useCallback, useEffect, useRef, type DragEvent, type MouseEvent, type PointerEvent } from 'react';
import { thumbUrl } from '../api/client';
import { LONG_PRESS_MS, LONG_PRESS_SLOP } from '../components/ContextMenu';
import type { PickModifiers, Selection } from './useSelectClick';


/** Outline + badge class from the file's issues: mismatch (red) beats missing (yellow); name-only gets a badge. */
function issueClass(e: EnrichedEntry, highlight: boolean) {
  if (!highlight || !e.issues.length) return { tile: '', badge: '' };
  if (e.issues.some((i) => i.category === 'mismatch')) return { tile: 'issue-mismatch', badge: 'mismatch' };
  if (e.issues.some((i) => i.category === 'missing')) return { tile: 'issue-missing', badge: '' };
  return { tile: '', badge: 'name' };
}

export function ContentGrid({
  entries,
  selection,
  onSelection,
  focused,
  pick,
  size,
  highlight,
  onDropFiles,
  onMenu,
  empty,
}: {
  entries: EnrichedEntry[];
  selection: Selection;
  onSelection: (s: Selection) => void;
  focused: string | null;
  /** The workspace's click selection (shared with custom panes so they keep one anchor). */
  pick: (rel: string, m?: PickModifiers) => void;
  size: number;
  highlight: boolean;
  onDropFiles?: (files: File[]) => void;
  /** Open the context menu for a tile (or empty space); the workspace applies the selection rules. */
  onMenu?: (x: number, y: number, rel: string | null, touch: boolean) => void;
  empty: string;
}) {
  const area = useRef<HTMLDivElement>(null);
  // Pointer type of the last press: touch taps toggle tiles (like Cmd/Ctrl-click) so a tablet can multi-select.
  const pointer = useRef<string>('mouse');
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const longPressed = useRef(false);

  const click = useCallback(
    (e: MouseEvent, rel: string) => {
      if (longPressed.current) {
        longPressed.current = false;
        return;
      }
      pick(rel, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey, touch: pointer.current === 'touch' });
    },
    [pick],
  );

  const onMenuRef = useRef(onMenu);
  onMenuRef.current = onMenu;

  const tileAt = (target: EventTarget | null) => (target as HTMLElement | null)?.closest<HTMLElement>('[data-rel]')?.dataset.rel ?? null;

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);

  const onPointerDown = (e: PointerEvent) => {
    pointer.current = e.pointerType;
    longPressed.current = false;
    cancelPress();
    if (e.pointerType !== 'touch' || !onMenu) return;
    const rel = tileAt(e.target);
    if (!rel) return;
    const { clientX: x, clientY: y } = e;
    press.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        press.current = null;
        longPressed.current = true;
        onMenuRef.current?.(x, y, rel, true);
      }, LONG_PRESS_MS),
    };
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP) cancelPress();
  };

  // Keyboard: Cmd/Ctrl+A select all, Esc clear, arrows move focus.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        onSelection(new Set(entries.map((x) => x.rel)));
      } else if (e.key === 'Escape') {
        onSelection(new Set());
      } else if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key) && entries.length) {
        e.preventDefault();
        const cols = Math.max(1, Math.floor((el.clientWidth - 24) / (size + 12)));
        const i = Math.max(0, entries.findIndex((x) => x.rel === focused));
        const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key]!;
        const next = entries[Math.min(entries.length - 1, Math.max(0, i + delta))];
        pick(next.rel);
        el.querySelector(`[data-rel="${CSS.escape(next.rel)}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [entries, focused, size, onSelection, pick]);

  const drag = (e: DragEvent, on: boolean) => {
    if (!onDropFiles || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    area.current?.classList.toggle('dropping', on);
  };

  return (
    <div
      className="grid-area"
      ref={area}
      tabIndex={0}
      onClick={(e) => {
        // On touch, a tap between tiles would too easily wipe a hand-built selection; use "Clear" instead.
        if (e.target === e.currentTarget && pointer.current !== 'touch') onSelection(new Set());
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(e) => {
        if (!onMenu) return;
        e.preventDefault();
        // Touch long-press is handled by our own timer (iOS never fires contextmenu, Android does).
        if (pointer.current === 'touch') return;
        onMenu(e.clientX, e.clientY, tileAt(e.target), false);
      }}
      onDragOver={(e) => drag(e, true)}
      onDragLeave={(e) => drag(e, false)}
      onDrop={(e) => {
        drag(e, false);
        if (onDropFiles && e.dataTransfer.files.length) onDropFiles([...e.dataTransfer.files]);
      }}
    >
      {entries.length === 0 ? (
        <div className="empty">{empty}</div>
      ) : (
        <div className="tiles" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
          {entries.map((e) => (
            <Tile key={e.rel} entry={e} selected={selection.has(e.rel)} size={size} highlight={highlight} onClick={click} />
          ))}
        </div>
      )}
    </div>
  );
}

const Tile = memo(function Tile({
  entry: e,
  selected,
  size,
  highlight,
  onClick,
}: {
  entry: EnrichedEntry;
  selected: boolean;
  size: number;
  highlight: boolean;
  onClick: (ev: MouseEvent, rel: string) => void;
}) {
  const cls = issueClass(e, highlight);
  const thumbSize = size <= 160 ? 320 : 640;
  return (
    <div
      className={`tile ${selected ? 'selected' : ''} ${cls.tile}`}
      data-rel={e.rel}
      onClick={(ev) => onClick(ev, e.rel)}
      title={highlight && e.issues.length ? e.issues.map((i) => `• ${i.message}`).join('\n') : e.name}
    >
      <div className="tile-thumb">
        <img src={thumbUrl(e, thumbSize)} loading="lazy" decoding="async" alt="" draggable={false} />
      </div>
      {e.kind === 'video' && <span className="tile-kind">VIDEO</span>}
      {highlight && e.issues.length > 0 && <span className={`tile-badge ${cls.badge}`}>{e.issues.length}</span>}
      <div className="tile-name">{e.name}</div>
      <div className="tile-meta">{e.resolved ? `${formatDisplay(e.resolved.local)} ${e.resolved.offset}` : 'No date'}</div>
    </div>
  );
});
