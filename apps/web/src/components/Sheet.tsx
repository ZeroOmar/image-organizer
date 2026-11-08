import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Bottom sheet for phones (folders, filters, the More menu). Closes on backdrop tap and Escape. */
export function Sheet({
  title,
  tools,
  onClose,
  children,
  full,
}: {
  title: string;
  /** Controls at the right of the header, before the close button. */
  tools?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Take (almost) the whole screen height instead of sizing to the content. */
  full?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet${full ? ' full' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grip" aria-hidden />
        <div className="sheet-head">
          <span className="eyebrow grow">{title}</span>
          {tools}
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export type DockSnap = 'peek' | 'half' | 'full';
const DOCK_ORDER: DockSnap[] = ['peek', 'half', 'full'];
/** Snap heights as a share of the parent (peek is the header only). */
const DOCK_SHARE: Record<DockSnap, number> = { peek: 0, half: 0.45, full: 0.8 };

/**
 * Non-modal panel docked under the page content (the GPS file list on phones): the content above stays usable.
 * Tap the handle to cycle peek → half → full; drag it to resize, and it snaps to the nearest height.
 */
export function DockSheet({ title, tools, children }: { title: ReactNode; tools?: ReactNode; children: ReactNode }) {
  const [snap, setSnap] = useState<DockSnap>('half');
  const [drag, setDrag] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const parentH = () => ref.current?.parentElement?.clientHeight ?? window.innerHeight;
  const height = drag ?? (snap === 'peek' ? undefined : DOCK_SHARE[snap] * parentH());

  return (
    <div ref={ref} className={`dock-sheet ${drag === null ? snap : 'dragging'}`} style={height !== undefined ? { height } : undefined}>
      <div
        className="dock-handle"
        role="button"
        tabIndex={0}
        aria-label={`Resize ${typeof title === 'string' ? title : 'panel'}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { y: e.clientY, h: ref.current?.offsetHeight ?? 0, moved: false };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dy = s.y - e.clientY;
          if (Math.abs(dy) > 6) s.moved = true;
          if (s.moved) setDrag(Math.max(48, Math.min(parentH() * 0.9, s.h + dy)));
        }}
        onPointerUp={() => {
          const s = start.current;
          start.current = null;
          if (!s) return;
          if (!s.moved) {
            setSnap(DOCK_ORDER[(DOCK_ORDER.indexOf(snap) + 1) % DOCK_ORDER.length]);
          } else if (drag !== null) {
            const share = drag / parentH();
            const near = DOCK_ORDER.reduce((a, b) => (Math.abs(DOCK_SHARE[b] - share) < Math.abs(DOCK_SHARE[a] - share) ? b : a));
            setSnap(near);
          }
          setDrag(null);
        }}
        onPointerCancel={() => ((start.current = null), setDrag(null))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSnap(DOCK_ORDER[(DOCK_ORDER.indexOf(snap) + 1) % DOCK_ORDER.length]);
          }
        }}
      >
        <div className="sheet-grip" aria-hidden />
        <div className="dock-head">
          <span className="eyebrow grow">{title}</span>
          <span onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            {tools}
          </span>
        </div>
      </div>
      {snap !== 'peek' || drag !== null ? <div className="dock-body">{children}</div> : null}
    </div>
  );
}
