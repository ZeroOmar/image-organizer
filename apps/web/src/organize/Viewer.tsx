import { formatDisplay, type EnrichedEntry } from '@io/shared';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { fileUrl } from '../api/client';
import { MetadataPanel, type MetadataEditing } from './MetadataPanel';

const SWIPE_PX = 50;

/**
 * Phone viewer: one file full screen. Swipe (or ‹ ›, arrow keys) between the visible files, Info pulls up the
 * Metadata panel (with inline editing when the page allows it), Select switches to selection with this file.
 */
export function Viewer({
  entries,
  entry,
  onNavigate,
  onClose,
  onSelect,
  editing,
}: {
  entries: EnrichedEntry[];
  entry: EnrichedEntry;
  onNavigate: (rel: string) => void;
  onClose: () => void;
  onSelect: () => void;
  editing?: MetadataEditing;
}) {
  const [info, setInfo] = useState(false);
  const [tab, setTab] = useState<'summary' | 'all'>('summary');
  const start = useRef<{ x: number; y: number } | null>(null);
  const i = entries.findIndex((e) => e.rel === entry.rel);
  const prev = i > 0 ? entries[i - 1] : null;
  const next = i >= 0 && i < entries.length - 1 ? entries[i + 1] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog opened from here (e.g. Edit on map) handles its own keys.
      if (document.querySelector('.dialog-backdrop')) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && prev) onNavigate(prev.rel);
      else if (e.key === 'ArrowRight' && next) onNavigate(next.rel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose, onNavigate]);

  const down = (e: PointerEvent) => {
    start.current = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
  };
  const up = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const to = dx < 0 ? next : prev;
      if (to) onNavigate(to.rel);
    } else if (dy < -SWIPE_PX && Math.abs(dy) > Math.abs(dx) * 1.5) setInfo(true);
    else if (dy > SWIPE_PX && Math.abs(dy) > Math.abs(dx) * 1.5) {
      if (info) setInfo(false);
      else onClose();
    }
  };

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label={entry.name}>
      <div className="viewer-head">
        <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="viewer-title grow">
          <div className="viewer-name">{entry.name}</div>
          <div className="caption subtle">
            {i + 1} / {entries.length}
            {entry.resolved ? ` · ${formatDisplay(entry.resolved.local)} ${entry.resolved.offset}` : ' · No date'}
          </div>
        </div>
        <button className="btn btn-sm" onClick={onSelect}>
          Select
        </button>
      </div>
      <div className="viewer-stage" onPointerDown={down} onPointerUp={up} onPointerCancel={() => (start.current = null)}>
        {entry.kind === 'video' ? (
          <video key={entry.rel} src={fileUrl(entry)} controls playsInline preload="metadata" />
        ) : (
          <img key={entry.rel} src={fileUrl(entry)} alt={entry.name} draggable={false} />
        )}
        {prev && (
          <button className="viewer-nav prev" onClick={() => onNavigate(prev.rel)} aria-label="Previous file">
            ‹
          </button>
        )}
        {next && (
          <button className="viewer-nav next" onClick={() => onNavigate(next.rel)} aria-label="Next file">
            ›
          </button>
        )}
      </div>
      {info ? (
        <div className="viewer-info">
          <div className="pane-head">
            <button className={`tab ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>
              Metadata
            </button>
            <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
              All tags
            </button>
            <div className="pane-head-tools">
              <button className="btn btn-ghost btn-sm" onClick={() => setInfo(false)}>
                Hide
              </button>
            </div>
          </div>
          <div className="viewer-info-body">
            <MetadataPanel key={entry.rel} entry={entry} tab={tab} editing={editing} />
          </div>
        </div>
      ) : (
        <div className="viewer-foot">
          <button className="btn" onClick={() => setInfo(true)}>
            Info{entry.issues.length > 0 && <span className={`pill ${entry.issues.some((x) => x.category === 'mismatch') ? 'pill-error' : 'pill-warning'}`}>{entry.issues.length}</span>}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
