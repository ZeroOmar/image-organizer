import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Dialog({
  title,
  eyebrow,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <div className="grow">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <div className="card-title" style={{ fontSize: 20 }}>
              {title}
            </div>
          </div>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
