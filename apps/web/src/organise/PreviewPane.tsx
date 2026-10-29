import type { EnrichedEntry } from '@io/shared';
import { fileUrl } from '../api/client';

/** Images are shown as-is (HEIC via server JPEG preview); videos stream the original with range requests. */
export function PreviewPane({ entry }: { entry: EnrichedEntry | null }) {
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
