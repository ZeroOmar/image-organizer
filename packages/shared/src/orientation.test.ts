import { describe, expect, it } from 'vitest';
import { computeIssues } from './issues.js';
import type { MediaEntry } from './media.js';
import {
  describeOrientation,
  displaySize,
  isFrontCamera,
  mirrorOrientation,
  orientationForTurn,
  orientMethod,
  rotateOrientation,
} from './orientation.js';
import { defaultSettings } from './settings.js';

type M = number[][];
const flipH = (m: M) => m.map((r) => [...r].reverse());
const flipV = (m: M) => [...m].reverse();
const transpose = (m: M) => m[0].map((_, c) => m.map((r) => r[c]));
const rotCW = (m: M) => flipH(transpose(m));
const rotCCW = (m: M) => flipV(transpose(m));

/** How a viewer shows stored pixels for each EXIF Orientation (spec, independent of orientation.ts). */
const SHOW: Record<number, (m: M) => M> = {
  1: (m) => m,
  2: flipH,
  3: (m) => flipV(flipH(m)),
  4: flipV,
  5: transpose,
  6: rotCW,
  7: (m) => rotCW(flipH(m)),
  8: rotCCW,
};

const stored: M = [
  [1, 2, 3],
  [4, 5, 6],
];

describe('orientation', () => {
  it('rotates and mirrors what is shown, from every starting orientation', () => {
    for (let o = 1; o <= 8; o++) {
      const shown = SHOW[o](stored);
      expect(SHOW[rotateOrientation(o, 90)](stored), `${o} right`).toEqual(rotCW(shown));
      expect(SHOW[rotateOrientation(o, 270)](stored), `${o} left`).toEqual(rotCCW(shown));
      expect(SHOW[rotateOrientation(o, 180)](stored), `${o} 180`).toEqual(rotCW(rotCW(shown)));
      expect(SHOW[mirrorOrientation(o, 'horizontal')](stored), `${o} mirror h`).toEqual(flipH(shown));
      expect(SHOW[mirrorOrientation(o, 'vertical')](stored), `${o} mirror v`).toEqual(flipV(shown));
    }
  });

  it('treats a missing or invalid orientation as normal', () => {
    expect(rotateOrientation(undefined, 90)).toBe(6);
    expect(mirrorOrientation(0, 'horizontal')).toBe(2);
    expect(orientationForTurn(270)).toBe(8);
    expect(describeOrientation(7)).toBe('Mirrored, rotated 90° right');
    expect(describeOrientation(undefined)).toBe('Normal');
  });

  it('picks the lossless method per format', () => {
    expect(orientMethod('a.JPG', 'photo')).toBe('exif');
    expect(orientMethod('a.heic', 'photo')).toBe('heif');
    expect(orientMethod('a.mov', 'video')).toBe('video');
    expect(orientMethod('a.png', 'photo')).toBeNull();
  });

  it('computes the shown size from orientation or rotation', () => {
    expect(displaySize({ width: 640, height: 480, orientation: 6 })).toEqual({ width: 480, height: 640 });
    expect(displaySize({ width: 640, height: 480, orientation: 6, rotation: 0 })).toEqual({ width: 640, height: 480 });
    expect(displaySize({ width: 1920, height: 1080, rotation: 270 })).toEqual({ width: 1080, height: 1920 });
  });

  it('flags front-camera photos until they are mirrored', () => {
    const entry = (meta: MediaEntry['meta'], name = 'IMG_1.jpg'): MediaEntry => ({ root: 'media', rel: name, name, kind: 'photo', size: 1, mtimeMs: 0, meta });
    const ids = (e: MediaEntry) => computeIssues({ entry: e, resolved: null, settings: defaultSettings(), folder: '' }).map((i) => i.id);
    const lens = 'iPhone 15 Pro front camera 2.69mm f/1.9';
    expect(isFrontCamera({ lens })).toBe(true);
    expect(isFrontCamera({ lens: 'iPhone 15 Pro back triple camera 6.765mm f/1.78' })).toBe(false);
    expect(ids(entry({ lens, orientation: 6 }))).toContain('frontCamera');
    expect(ids(entry({ lens, orientation: 7 }))).not.toContain('frontCamera');
    expect(ids(entry({ lens: 'iPhone 15 Pro back camera' }))).not.toContain('frontCamera');
  });
});
