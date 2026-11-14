import type { Selection, Step } from '@io/shared';
import { useState } from 'react';
import { ActionDialog } from '../../components/ActionDialog';

type Choice = 'left' | 'right' | 'half' | 'mirrorH' | 'mirrorV';

const CHOICES: { id: Choice; label: string; hint: string; step: Step }[] = [
  { id: 'left', label: 'Rotate left', hint: '90° counter-clockwise', step: { type: 'rotate', degrees: 270 } },
  { id: 'right', label: 'Rotate right', hint: '90° clockwise', step: { type: 'rotate', degrees: 90 } },
  { id: 'half', label: 'Rotate 180°', hint: 'upside down', step: { type: 'rotate', degrees: 180 } },
  { id: 'mirrorH', label: 'Mirror left ↔ right', hint: 'fixes selfies saved with the mirror effect', step: { type: 'mirror', axis: 'horizontal' } },
  { id: 'mirrorV', label: 'Mirror top ↔ bottom', hint: 'flip vertically', step: { type: 'mirror', axis: 'vertical' } },
];

/**
 * Rotate or mirror without re-encoding: only the orientation tag changes (EXIF Orientation for JPEG,
 * irot for HEIC, the track rotation for videos). HEIC can't be mirrored that way, so mirroring
 * offers to convert HEIC to JPG first in the same job.
 */
export function OrientDialog({ selection, heicCount, onClose }: { selection: Selection; heicCount: number; onClose: () => void }) {
  const [choice, setChoice] = useState<Choice>('right');
  const [convertHeic, setConvertHeic] = useState(true);
  const c = CHOICES.find((x) => x.id === choice)!;
  const mirror = c.step.type === 'mirror';
  const steps: Step[] = mirror && heicCount && convertHeic ? [{ type: 'heicToJpeg' }, c.step] : [c.step];

  return (
    <ActionDialog title="Rotate & mirror" eyebrow="Batch action" selection={selection} steps={steps} onClose={onClose}>
      <div className="stack" style={{ gap: 10 }}>
        {CHOICES.map((x) => (
          <label className="check" key={x.id}>
            <input type="radio" checked={choice === x.id} onChange={() => setChoice(x.id)} />
            <span>
              <strong>{x.label}</strong>
              <span className="muted"> — {x.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {mirror && heicCount > 0 && (
        <label className="check">
          <input type="checkbox" checked={convertHeic} onChange={(e) => setConvertHeic(e.target.checked)} />
          <span>
            <strong>Convert HEIC to JPG first</strong>
            <span className="muted">
              {' '}
              — {heicCount} HEIC photo{heicCount === 1 ? '' : 's'} selected. HEIC can’t be mirrored without re-encoding; the originals go to the trash.
            </span>
          </span>
        </label>
      )}
      <p className="caption muted" style={{ margin: 0 }}>
        Lossless: the pixels aren’t re-encoded, only the orientation tag changes, which browsers and photo apps apply. Works on JPEG and HEIC
        photos{mirror ? ' (mirror: JPEG only)' : ' and videos'}; other files are skipped. Undo restores the previous orientation.
      </p>
    </ActionDialog>
  );
}
