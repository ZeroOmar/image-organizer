import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Draw a divider above this item. */
  separator?: boolean;
}

/** Floating menu at a viewport point. Closes on outside press, Escape, scroll, resize and window blur. */
export function ContextMenu({ x, y, title, items, onClose }: { x: number; y: number; title?: string; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // A long-press opens the menu under the finger; the lift that follows must not activate an item.
  // Items fire only after a press that started inside the menu (or from the keyboard, detail 0).
  const armed = useRef(false);

  // Keep the menu inside the viewport (flip left/up when it would overflow).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: x + width + pad > window.innerWidth ? Math.max(pad, x - width) : x,
      top: y + height + pad > window.innerHeight ? Math.max(pad, window.innerHeight - height - pad) : y,
    });
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const close = () => onClose();
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
      next?.focus();
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={pos}
      onKeyDown={onKey}
      onPointerDown={() => (armed.current = true)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {title && <div className="eyebrow context-menu-title">{title}</div>}
      {items.map((it, i) => (
        <Fragment key={i}>
          {it.separator && <div className="context-menu-sep" />}
          <button
            role="menuitem"
            className={it.danger ? 'danger' : ''}
            disabled={it.disabled}
            onClick={(e) => {
              if (e.detail !== 0 && !armed.current) return;
              onClose();
              it.onSelect();
            }}
          >
            {it.label}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
