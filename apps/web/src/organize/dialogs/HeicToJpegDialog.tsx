import type { Selection } from '@io/shared';
import { useState } from 'react';
import { useSettings } from '../../api/hooks';
import { ActionDialog } from '../../components/ActionDialog';

/** Save the selected HEIC/HEIF photos as JPG. Quality defaults to Settings → Conversion. */
export function HeicToJpegDialog({ selection, count, onClose }: { selection: Selection; count: number; onClose: () => void }) {
  const def = useSettings().data?.convert.jpegQuality ?? 90;
  const [quality, setQuality] = useState<number | null>(null);
  const q = quality ?? def;
  return (
    <ActionDialog
      title={`Convert ${count} HEIC photo${count === 1 ? '' : 's'} to JPG`}
      eyebrow="Batch action"
      selection={selection}
      steps={[{ type: 'heicToJpeg', quality: q }]}
      applyLabel="Convert"
      onClose={onClose}
    >
      <p className="muted" style={{ margin: 0 }}>
        Saves each photo as a .jpg with the same name, at full resolution and upright. Dates, timezone, GPS, camera details and the color profile
        are kept. Each original goes to the trash, so Undo works until the trash is emptied. Other files in the selection are skipped.
      </p>
      <div className="field">
        <label>JPEG quality</label>
        <label className="row" style={{ gap: 8 }}>
          <input type="range" className="grow" min={60} max={100} value={q} onChange={(e) => setQuality(Number(e.target.value))} aria-label="JPEG quality" />
          <span className="mono">{q}</span>
        </label>
        <span className="hint">90 is visually lossless for photos. JPGs are usually 1.5–2× larger than the HEIC.</span>
      </div>
    </ActionDialog>
  );
}
