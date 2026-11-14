import { extOf, isHeif, type MediaKind, type MediaMeta } from './media.js';

/** Clockwise quarter turns, in degrees. */
export type Turn = 0 | 90 | 180 | 270;
export type MirrorAxis = 'horizontal' | 'vertical';

/**
 * How a file is shown: stored pixels mirrored left↔right first (`flip`), then turned `rot` degrees clockwise.
 * The eight EXIF Orientation values are the eight such poses.
 */
interface Pose {
  flip: boolean;
  rot: Turn;
}

const POSES: Record<number, Pose> = {
  1: { flip: false, rot: 0 },
  2: { flip: true, rot: 0 },
  3: { flip: false, rot: 180 },
  4: { flip: true, rot: 180 },
  5: { flip: true, rot: 270 },
  6: { flip: false, rot: 90 },
  7: { flip: true, rot: 90 },
  8: { flip: false, rot: 270 },
};

const turn = (deg: number): Turn => ((((deg % 360) + 360) % 360) as Turn);
const poseOf = (o: number | undefined): Pose => POSES[o ?? 1] ?? POSES[1];
const orientationOf = (p: Pose): number => Number(Object.entries(POSES).find(([, q]) => q.flip === p.flip && q.rot === p.rot)![0]);

/** EXIF Orientation after turning the shown image `deg` clockwise. */
export function rotateOrientation(o: number | undefined, deg: number): number {
  const p = poseOf(o);
  return orientationOf({ flip: p.flip, rot: turn(p.rot + deg) });
}

/**
 * EXIF Orientation after mirroring the shown image. A left↔right mirror M of R(r)·F^f is
 * R(−r)·F^(1−f) (since M·R(r) = R(−r)·M); top↔bottom is that plus a half turn.
 */
export function mirrorOrientation(o: number | undefined, axis: MirrorAxis): number {
  const p = poseOf(o);
  return orientationOf({ flip: !p.flip, rot: turn(-p.rot + (axis === 'vertical' ? 180 : 0)) });
}

/** EXIF Orientation of an unmirrored image turned `deg` clockwise. */
export const orientationForTurn = (deg: number): number => orientationOf({ flip: false, rot: turn(deg) });

export const isMirroredOrientation = (o: number | undefined) => poseOf(o).flip;

const turnText = (rot: Turn) => (rot === 90 ? 'rotated 90° right' : rot === 180 ? 'rotated 180°' : rot === 270 ? 'rotated 90° left' : '');

/** "Normal", "Rotated 90° right", "Mirrored, rotated 180°" … */
export function describeOrientation(o: number | undefined): string {
  return describePose(poseOf(o));
}

export function describeTurn(deg: number | undefined): string {
  return describePose({ flip: false, rot: turn(deg ?? 0) });
}

function describePose(p: Pose): string {
  const parts = [p.flip ? 'mirrored' : '', turnText(p.rot)].filter(Boolean);
  if (!parts.length) return 'Normal';
  const s = parts.join(', ');
  return s[0].toUpperCase() + s.slice(1);
}

/**
 * How a file's orientation can be changed without re-encoding:
 * - `exif`: JPEG, the EXIF Orientation tag (rotate and mirror).
 * - `heif`: HEIC/HEIF, the `irot` item property (rotate only; ExifTool can't add an `imir` mirror).
 * - `video`: MP4/MOV, the track matrix rotation (rotate only).
 * - null: not supported (PNG, WebP: browsers don't reliably honor their EXIF orientation).
 */
export function orientMethod(name: string, kind: MediaKind): 'exif' | 'heif' | 'video' | null {
  if (kind === 'video') return 'video';
  if (isHeif(name)) return 'heif';
  return ['.jpg', '.jpeg', '.jpe'].includes(extOf(name)) ? 'exif' : null;
}

/** Shown width/height after the file's orientation or rotation is applied. */
export function displaySize(meta: MediaMeta): { width: number; height: number } | null {
  const { width: w, height: h } = meta;
  if (!w || !h) return null;
  // HEIF and video carry their own rotation; their EXIF Orientation (if any) only repeats it.
  const quarter = (meta.rotation ?? poseOf(meta.orientation).rot) % 180 === 90;
  return quarter ? { width: h, height: w } : { width: w, height: h };
}

/**
 * The front (selfie) camera took this photo, per the lens name phones write
 * (iPhone: "iPhone 15 front camera 2.69mm f/1.9"; some Android phones do the same).
 */
export const isFrontCamera = (meta: MediaMeta) => /\bfront\b/i.test(meta.lens ?? '');
