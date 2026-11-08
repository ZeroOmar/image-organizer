import type { MouseEvent } from 'react';
import type { PickModifiers } from './useSelectClick';

/**
 * The selection checkbox on a grid tile or list row: the way to multi-select on touch (a tap on the file itself
 * selects only that file). Toggles the file; Shift extends the range from the last picked file.
 */
export function SelectCheck({
  rel,
  checked,
  pick,
  className = '',
}: {
  rel: string;
  checked: boolean;
  pick: (rel: string, m?: PickModifiers) => void;
  className?: string;
}) {
  return (
    <label
      className={`select-check ${className}`}
      // A tap here is not a tap on the tile/row underneath, nor the start of its long-press.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        readOnly
        aria-label={checked ? 'Deselect' : 'Select'}
        onClick={(e: MouseEvent) => pick(rel, { toggle: true, shift: e.shiftKey })}
      />
    </label>
  );
}
