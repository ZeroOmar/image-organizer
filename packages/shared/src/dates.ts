import type { MediaEntry } from './media.js';

/** A calendar date + time with no zone attached. */
export interface Wall {
  y: number;
  M: number;
  d: number;
  h: number;
  m: number;
  s: number;
  ms: number;
}

export type DateSourceId = 'original' | 'create' | 'filename' | 'fileModify';

export const DATE_SOURCES: { id: DateSourceId; label: string; description: string }[] = [
  { id: 'original', label: 'Date Time Original', description: 'EXIF DateTimeOriginal (photos) or QuickTime creation date (videos)' },
  { id: 'create', label: 'Create Date', description: 'EXIF CreateDate (photos) or QuickTime CreateDate in UTC (videos)' },
  { id: 'filename', label: 'Date in filename', description: 'Parsed from names like IMG-20261008-WA0001 or 20261008_094004' },
  { id: 'fileModify', label: 'File modified date', description: 'Filesystem modification time' },
];

export type DateCandidate =
  | { source: DateSourceId; type: 'wall'; wall: Wall; offsetMin: number | null; dateOnly: boolean }
  | { source: DateSourceId; type: 'instant'; utcMs: number };

export interface ResolvedDate {
  /** Local wall time in `tz`. */
  local: Wall;
  /** IANA zone name or a fixed offset like "+03:00". */
  tz: string;
  /** Offset of `local` from UTC, e.g. "+03:00". */
  offset: string;
  utcMs: number;
  source: DateSourceId;
  /** Where the zone came from. */
  tzSource: 'offset' | 'gps' | 'default';
  /** True when no source provided a time of day (e.g. WhatsApp names) and 00:00:00 was used. */
  dateOnly: boolean;
  /** Set when the time of day was borrowed from a lower-priority source. */
  timeFrom?: DateSourceId;
}

const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');

export function wallToUtcMs(w: Wall): number {
  return Date.UTC(w.y, w.M - 1, w.d, w.h, w.m, w.s, w.ms);
}

export function utcMsToWall(ms: number): Wall {
  const t = new Date(ms);
  return {
    y: t.getUTCFullYear(),
    M: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    h: t.getUTCHours(),
    m: t.getUTCMinutes(),
    s: t.getUTCSeconds(),
    ms: t.getUTCMilliseconds(),
  };
}

function validWall(w: Wall): boolean {
  if (w.y < 1900 || w.y > 2200 || w.M < 1 || w.M > 12 || w.d < 1 || w.d > 31) return false;
  if (w.h > 23 || w.m > 59 || w.s > 59) return false;
  const back = utcMsToWall(wallToUtcMs(w));
  return back.d === w.d && back.M === w.M;
}

export function parseOffset(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  if (t === 'Z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(t);
  if (!m) return null;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -v : v;
}

export function formatOffset(min: number): string {
  return `${min < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`;
}

/** Parse an ExifTool date string: "YYYY:MM:DD HH:MM:SS[.sss][±HH:MM|Z]". */
export function parseExifDate(s: string | null | undefined): { wall: Wall; offsetMin: number | null } | null {
  if (!s || typeof s !== 'string') return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(s.trim());
  if (!m) return null;
  const wall: Wall = {
    y: +m[1], M: +m[2], d: +m[3], h: +m[4], m: +m[5], s: +m[6],
    ms: m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0,
  };
  if (!validWall(wall)) return null;
  return { wall, offsetMin: parseOffset(m[8]) };
}

export function formatExifDate(w: Wall): string {
  return `${pad(w.y, 4)}:${pad(w.M)}:${pad(w.d)} ${pad(w.h)}:${pad(w.m)}:${pad(w.s)}`;
}

/** "YYYY-MM-DDTHH:mm:ss" — the format used by <input type="datetime-local" step=1>. */
export function formatIsoLocal(w: Wall): string {
  return `${pad(w.y, 4)}-${pad(w.M)}-${pad(w.d)}T${pad(w.h)}:${pad(w.m)}:${pad(w.s)}`;
}

export function parseIsoLocal(s: string): Wall | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const w: Wall = { y: +m[1], M: +m[2], d: +m[3], h: +m[4], m: +m[5], s: m[6] ? +m[6] : 0, ms: 0 };
  return validWall(w) ? w : null;
}

export function formatDisplay(w: Wall): string {
  return `${pad(w.y, 4)}-${pad(w.M)}-${pad(w.d)} ${pad(w.h)}:${pad(w.m)}:${pad(w.s)}`;
}

/**
 * Find a date (and optionally time) in a file name. Handles our own template output
 * (20261008_09400401_PIC), camera names (IMG_20261008_094004, PXL_20261008_094004123),
 * WhatsApp (IMG-20261008-WA0001 → date only) and screenshots (2026-10-08 at 09.40.04).
 */
export function parseFilenameDate(name: string): { wall: Wall; dateOnly: boolean } | null {
  const re =
    /(?<!\d)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:(?:[ _\-T.]|\sat\s)([01]\d|2[0-3])[-_.:]?([0-5]\d)[-_.:]?([0-5]\d))?/;
  const m = re.exec(name);
  if (!m) return null;
  const hasTime = m[4] !== undefined;
  const wall: Wall = {
    y: +m[1], M: +m[2], d: +m[3],
    h: hasTime ? +m[4] : 0, m: hasTime ? +m[5] : 0, s: hasTime ? +m[6] : 0, ms: 0,
  };
  if (!validWall(wall)) return null;
  return { wall, dateOnly: !hasTime };
}

/** UTC offset in minutes for an IANA zone (or fixed "+03:00"/"UTC") at a given instant. */
export function zoneOffsetMinutes(tz: string, utcMs: number): number {
  if (tz === 'UTC' || tz === 'Etc/UTC') return 0;
  const fixed = parseOffset(tz);
  if (fixed !== null) return fixed;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date(utcMs));
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  if (name === 'GMT') return 0;
  return parseOffset(name.replace('GMT', '')) ?? 0;
}

export function isValidZone(tz: string): boolean {
  if (parseOffset(tz) !== null) return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function wallInZoneToUtc(w: Wall, tz: string): number {
  const guess = wallToUtcMs(w);
  const off1 = zoneOffsetMinutes(tz, guess);
  let utc = guess - off1 * 60_000;
  const off2 = zoneOffsetMinutes(tz, utc);
  if (off2 !== off1) utc = guess - off2 * 60_000;
  return utc;
}

export function utcToWallInZone(ms: number, tz: string): Wall {
  return utcMsToWall(ms + zoneOffsetMinutes(tz, ms) * 60_000);
}

function subSecMs(s: string | undefined): number {
  if (!s) return 0;
  const digits = String(s).replace(/\D/g, '');
  return digits ? Math.round(Number(`0.${digits}`) * 1000) : 0;
}

/** All date candidates a file offers, keyed by source. */
export function dateCandidates(e: MediaEntry): Partial<Record<DateSourceId, DateCandidate>> {
  const out: Partial<Record<DateSourceId, DateCandidate>> = {};
  const meta = e.meta;
  if (e.kind === 'photo') {
    const o = parseExifDate(meta.dateTimeOriginal);
    if (o) {
      o.wall.ms = o.wall.ms || subSecMs(meta.subSecTimeOriginal);
      out.original = { source: 'original', type: 'wall', wall: o.wall, offsetMin: o.offsetMin ?? parseOffset(meta.offsetTimeOriginal), dateOnly: false };
    }
    const c = parseExifDate(meta.createDate);
    if (c) out.create = { source: 'create', type: 'wall', wall: c.wall, offsetMin: c.offsetMin ?? parseOffset(meta.offsetTime), dateOnly: false };
  } else {
    const keys = parseExifDate(meta.qtCreationDate);
    const qt = parseExifDate(meta.qtCreateDate);
    const qtInstant = qt ? { source: 'create' as const, type: 'instant' as const, utcMs: wallToUtcMs(qt.wall) - (qt.offsetMin ?? 0) * 60_000 } : null;
    if (keys) out.original = { source: 'original', type: 'wall', wall: keys.wall, offsetMin: keys.offsetMin, dateOnly: false };
    else if (qtInstant) out.original = { ...qtInstant, source: 'original' };
    if (qtInstant) out.create = qtInstant;
  }
  const f = parseFilenameDate(e.name);
  if (f) out.filename = { source: 'filename', type: 'wall', wall: f.wall, offsetMin: null, dateOnly: f.dateOnly };
  if (e.mtimeMs > 0) out.fileModify = { source: 'fileModify', type: 'instant', utcMs: e.mtimeMs };
  return out;
}

/** The zone a file's dates should be shown/named in: its own offset → GPS zone → default. */
export function fileZone(e: MediaEntry, defaultTz: string): { tz: string; tzSource: ResolvedDate['tzSource'] } {
  const own =
    e.kind === 'photo'
      ? parseOffset(e.meta.offsetTimeOriginal) ?? parseExifDate(e.meta.dateTimeOriginal)?.offsetMin ?? null
      : parseExifDate(e.meta.qtCreationDate)?.offsetMin ?? null;
  if (own !== null && own !== undefined) return { tz: formatOffset(own), tzSource: 'offset' };
  if (e.gpsTz) return { tz: e.gpsTz, tzSource: 'gps' };
  return { tz: defaultTz, tzSource: 'default' };
}

function candidateLocal(c: DateCandidate, tz: string): { local: Wall; tz: string } {
  if (c.type === 'instant') return { local: utcToWallInZone(c.utcMs, tz), tz };
  if (c.offsetMin !== null) return { local: c.wall, tz: formatOffset(c.offsetMin) };
  return { local: c.wall, tz };
}

/** Pick the best date per the configured priority and express it as local time in the file's zone. */
export function resolveDate(e: MediaEntry, priority: DateSourceId[], defaultTz: string): ResolvedDate | null {
  const cands = dateCandidates(e);
  const zone = fileZone(e, defaultTz);
  for (let i = 0; i < priority.length; i++) {
    const c = cands[priority[i]];
    if (!c) continue;
    const { local, tz } = candidateLocal(c, zone.tz);
    let dateOnly = c.type === 'wall' && c.dateOnly;
    let timeFrom: DateSourceId | undefined;
    if (dateOnly) {
      // Borrow the time of day from a lower-priority source that falls on the same day.
      for (const next of priority.slice(i + 1)) {
        const n = cands[next];
        if (!n || (n.type === 'wall' && n.dateOnly)) continue;
        const nl = candidateLocal(n, tz).local;
        if (nl.y === local.y && nl.M === local.M && nl.d === local.d) {
          Object.assign(local, { h: nl.h, m: nl.m, s: nl.s, ms: nl.ms });
          dateOnly = false;
          timeFrom = next;
          break;
        }
      }
    }
    const utcMs = wallInZoneToUtc(local, tz);
    return {
      local,
      tz,
      offset: formatOffset(zoneOffsetMinutes(tz, utcMs)),
      utcMs,
      source: c.source,
      tzSource: c.type === 'wall' && c.offsetMin !== null ? 'offset' : zone.tzSource,
      dateOnly,
      timeFrom,
    };
  }
  return null;
}
