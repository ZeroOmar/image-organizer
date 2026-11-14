import {
  describeOrientation,
  describeTurn,
  formatExifDate,
  mirrorOrientation,
  orientationForTurn,
  orientMethod,
  rotateOrientation,
  utcMsToWall,
  type GpsPoint,
  type MediaKind,
  type MediaMeta,
  type MirrorAxis,
  type Wall,
} from '@io/shared';
import type { TagMap } from './exiftool.js';

/**
 * Tags written when setting a capture date.
 * Photos: EXIF local wall time + OffsetTime* (EXIF 2.31).
 * Videos: QuickTime dates are UTC by spec; Keys:CreationDate carries local time with offset.
 */
export function dateTags(kind: MediaKind, local: Wall, offset: string, utcMs: number): TagMap {
  if (kind === 'photo') {
    const v = formatExifDate(local);
    return {
      DateTimeOriginal: v,
      CreateDate: v,
      OffsetTimeOriginal: offset,
      OffsetTimeDigitized: offset,
      OffsetTime: offset,
    };
  }
  const utc = formatExifDate(utcMsToWall(utcMs));
  return {
    'QuickTime:CreateDate': utc,
    'QuickTime:ModifyDate': utc,
    'QuickTime:TrackCreateDate': utc,
    'QuickTime:TrackModifyDate': utc,
    'QuickTime:MediaCreateDate': utc,
    'QuickTime:MediaModifyDate': utc,
    'Keys:CreationDate': `${formatExifDate(local)}${offset}`,
  };
}

/** Apply a date write to in-memory metadata (dry-run simulation). */
export function applyDateToMeta(kind: MediaKind, meta: MediaMeta, local: Wall, offset: string, utcMs: number): MediaMeta {
  if (kind === 'photo') {
    return { ...meta, dateTimeOriginal: formatExifDate(local), createDate: formatExifDate(local), offsetTimeOriginal: offset, offsetTime: offset };
  }
  return { ...meta, qtCreateDate: formatExifDate(utcMsToWall(utcMs)), qtCreationDate: `${formatExifDate(local)}${offset}` };
}

const PHOTO_GPS = ['GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef', 'GPSAltitude', 'GPSAltitudeRef'];
const VIDEO_GPS = ['Keys:GPSCoordinates', 'UserData:GPSCoordinates', 'ItemList:GPSCoordinates'];

/**
 * GPS tags. Photos: signed decimals WITHOUT -n — exiftool-vendored derives the N/S/E/W refs and
 * also writes GPSPosition as "lat,lon", which ExifTool rejects under -n (silently dropping lat/lon).
 * Videos: QuickTime GPSCoordinates only parses "lat lon alt" in numeric (-n) mode.
 */
export function gpsTags(kind: MediaKind, p: GpsPoint): { tags: TagMap; numeric: boolean } {
  if (kind === 'photo') {
    const tags: TagMap = { GPSLatitude: p.lat, GPSLongitude: p.lon };
    if (p.alt != null) Object.assign(tags, { GPSAltitude: Math.abs(p.alt), GPSAltitudeRef: p.alt < 0 ? 'Below Sea Level' : 'Above Sea Level' });
    else Object.assign(tags, { GPSAltitude: null, GPSAltitudeRef: null });
    return { tags, numeric: false };
  }
  const v = `${p.lat} ${p.lon} ${p.alt ?? 0}`;
  return { tags: { 'Keys:GPSCoordinates': v, 'UserData:GPSCoordinates': v }, numeric: true };
}

export function clearGpsTags(kind: MediaKind): { tags: TagMap; numeric: boolean } {
  return { tags: Object.fromEntries((kind === 'photo' ? PHOTO_GPS : VIDEO_GPS).map((t) => [t, null])), numeric: false };
}

/** Tag names an undo snapshot must capture before a GPS write/clear. */
export function gpsSnapshotTags(kind: MediaKind): string[] {
  return kind === 'photo' ? PHOTO_GPS : VIDEO_GPS;
}

export type OrientChange = { rotate: number } | { mirror: MirrorAxis };

export type OrientWrite =
  | { tags: TagMap; snapshot: string[]; meta: MediaMeta; before: string; after: string }
  | { skip: 'format' | 'mirrorHeif' | 'mirrorVideo' };

/**
 * Rotate or mirror without touching the pixels (all numeric, -n):
 * JPEG → EXIF Orientation; HEIF → irot (QuickTime:Rotation, counter-clockwise quarter turns), plus the
 * EXIF Orientation when present so it keeps matching; video → track matrix (Rotation, clockwise degrees).
 */
export function orientTags(name: string, kind: MediaKind, meta: MediaMeta, change: OrientChange): OrientWrite {
  const method = orientMethod(name, kind);
  if (!method) return { skip: 'format' };
  if (method === 'exif') {
    const next = 'rotate' in change ? rotateOrientation(meta.orientation, change.rotate) : mirrorOrientation(meta.orientation, change.mirror);
    return {
      tags: { Orientation: next },
      snapshot: ['Orientation'],
      meta: { ...meta, orientation: next },
      before: describeOrientation(meta.orientation),
      after: describeOrientation(next),
    };
  }
  if (!('rotate' in change)) return { skip: method === 'heif' ? 'mirrorHeif' : 'mirrorVideo' };
  const cur = meta.rotation ?? 0;
  const next = (cur + change.rotate) % 360;
  const before = describeTurn(cur);
  const after = describeTurn(next);
  if (method === 'video') return { tags: { Rotation: next }, snapshot: ['Rotation'], meta: { ...meta, rotation: next }, before, after };
  const tags: TagMap = { 'QuickTime:Rotation': ((360 - next) % 360) / 90 };
  const out: MediaMeta = { ...meta, rotation: next };
  if (meta.orientation !== undefined) {
    tags.Orientation = out.orientation = orientationForTurn(next);
  }
  return { tags, snapshot: Object.keys(tags), meta: out, before, after };
}
