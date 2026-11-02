import type { EnrichedEntry } from '@io/shared';
import { fileUrl, thumbUrl } from '../api/client';

const STACK_MAX = 5;

/**
 * One file: images are shown as-is (HEIC via server JPEG preview); videos stream the original with range requests.
 * Several selected files: a fanned stack of their thumbnails, the focused one on top.
 */
export function PreviewPane({ entry, selected = [] }: { entry: EnrichedEntry | null; selected?: EnrichedEntry[] }) {
  if (selected.length > 1) {
    const top = selected.find((e) => e.rel === entry?.rel) ?? selected[0];
    const rest = selected.filter((e) => e !== top).slice(0, STACK_MAX - 1);
    const stack = [...rest.reverse(), top];
    return (
      <div className="preview">
        <div className="preview-stack">
          {stack.map((e, i) => {
            const depth = stack.length - 1 - i;
            const turn = depth === 0 ? 0 : (depth % 2 ? -1 : 1) * (3 + depth * 2);
            return (
              <img
                key={e.rel}
                className={depth === 0 ? 'top' : ''}
                src={thumbUrl(e, 320)}
                alt={depth === 0 ? e.name : ''}
                style={{ transform: `translate(${depth * 6}px, ${-depth * 6}px) rotate(${turn}deg)`, zIndex: stack.length - depth }}
              />
            );
          })}
        </div>
        <div className="caption muted" style={{ textAlign: 'center', overflowWrap: 'anywhere' }}>
          <strong>{selected.length} files selected</strong>
          <br />
          {top.name} + {selected.length - 1} more
        </div>
      </div>
    );
  }
  if (!entry) return <div className="empty">Select a file to preview it.</div>;
  return (
    <div className="preview">
      {entry.kind === 'video' ? (
        <video key={entry.rel} src={fileUrl(entry)} controls preload="metadata" />
      ) : (
        <img key={entry.rel} src={fileUrl(entry)} alt={entry.name} />
      )}
      <div className="caption muted" style={{ textAlign: 'center', overflowWrap: 'anywhere' }}>
        {entry.name}
      </div>
    </div>
  );
}
