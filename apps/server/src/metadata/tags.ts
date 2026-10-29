import { formatExifDate, utcMsToWall, type GpsPoint, type MediaKind, type MediaMeta, type Wall } from '@io/shared';
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
