import { describe, expect, it } from 'vitest';
import { parseFilenameDate, resolveDate, utcToWallInZone, wallInZoneToUtc, zoneOffsetMinutes } from './dates.js';
import type { MediaEntry } from './media.js';

const entry = (over: Partial<MediaEntry> & { meta?: MediaEntry['meta'] }): MediaEntry => ({
  root: 'media',
  rel: `x/${over.name ?? 'a.jpg'}`,
  name: 'a.jpg',
  kind: 'photo',
  size: 1,
  mtimeMs: Date.UTC(2026, 9, 10, 12, 0, 0),
  meta: {},
  ...over,
});

describe('parseFilenameDate', () => {
  it.each([
    ['IMG-20261008-WA0001.jpg', { y: 2026, M: 10, d: 8, h: 0 }, true],
    ['VID-20261008-WA0001.mp4', { y: 2026, M: 10, d: 8, h: 0 }, true],
    ['20261008_09400401_PIC.jpg', { y: 2026, M: 10, d: 8, h: 9, m: 40, s: 4 }, false],
    ['IMG_20261008_094004.jpg', { y: 2026, M: 10, d: 8, h: 9, m: 40, s: 4 }, false],
    ['PXL_20261008_094004123.jpg', { y: 2026, M: 10, d: 8, h: 9, m: 40, s: 4 }, false],
    ['Screenshot 2026-10-08 at 09.40.04.png', { y: 2026, M: 10, d: 8, h: 9, m: 40, s: 4 }, false],
  ])('%s', (name, want, dateOnly) => {
    const r = parseFilenameDate(name)!;
    expect(r).not.toBeNull();
    expect(r.dateOnly).toBe(dateOnly);
    expect(r.wall).toMatchObject(want);
  });

  it('ignores non-dates', () => {
    expect(parseFilenameDate('DSC_1234.jpg')).toBeNull();
    expect(parseFilenameDate('20261340_000000.jpg')).toBeNull();
  });
});

describe('zones', () => {
  it('handles IANA and fixed offsets', () => {
    expect(zoneOffsetMinutes('+03:00', 0)).toBe(180);
    expect(zoneOffsetMinutes('UTC', 0)).toBe(0);
    expect(zoneOffsetMinutes('Asia/Tokyo', Date.UTC(2026, 0, 1))).toBe(540);
  });
  it('round trips wall time through a zone', () => {
    const w = { y: 2026, M: 7, d: 1, h: 10, m: 0, s: 0, ms: 0 };
    const utc = wallInZoneToUtc(w, 'Europe/Berlin');
    expect(utc).toBe(Date.UTC(2026, 6, 1, 8));
    expect(utcToWallInZone(utc, 'Europe/Berlin')).toEqual(w);
  });
});

describe('resolveDate', () => {
  const prio = ['original', 'create', 'filename', 'fileModify'] as const;

  it('uses OffsetTimeOriginal when present', () => {
    const r = resolveDate(entry({ meta: { dateTimeOriginal: '2026:08:27 14:13:05', offsetTimeOriginal: '+03:00' } }), [...prio], 'UTC')!;
    expect(r.source).toBe('original');
    expect(r.tz).toBe('+03:00');
    expect(r.tzSource).toBe('offset');
    expect(r.utcMs).toBe(Date.UTC(2026, 7, 27, 11, 13, 5));
  });

  it('prefers the GPS zone over the default', () => {
    const r = resolveDate(entry({ gpsTz: 'Asia/Tokyo', meta: { dateTimeOriginal: '2026:08:27 14:13:05' } }), [...prio], 'UTC')!;
    expect(r.tz).toBe('Asia/Tokyo');
    expect(r.tzSource).toBe('gps');
    expect(r.offset).toBe('+09:00');
  });

  it('converts QuickTime UTC into the zone', () => {
    const r = resolveDate(
      entry({ name: 'v.mp4', kind: 'video', meta: { qtCreateDate: '2026:10:08 06:40:04' } }),
      [...prio],
      'Africa/Cairo',
    )!;
    expect(r.local).toMatchObject({ h: 9, m: 40, s: 4 });
    expect(r.offset).toBe('+03:00');
  });

  it('borrows the time for WhatsApp date-only names from a same-day source', () => {
    const r = resolveDate(
      entry({ name: 'IMG-20261010-WA0001.jpg', mtimeMs: Date.UTC(2026, 9, 10, 9, 30, 0) }),
      ['original', 'filename', 'fileModify'],
      'Africa/Cairo',
    )!;
    expect(r.source).toBe('filename');
    expect(r.timeFrom).toBe('fileModify');
    expect(r.local).toMatchObject({ d: 10, h: 12, m: 30 });
    expect(r.dateOnly).toBe(false);
  });

  it('falls back to midnight when no same-day time exists', () => {
    const r = resolveDate(entry({ name: 'IMG-20260101-WA0001.jpg' }), ['filename', 'fileModify'], 'UTC')!;
    expect(r.dateOnly).toBe(true);
    expect(r.local).toMatchObject({ h: 0, m: 0, s: 0 });
  });
});
