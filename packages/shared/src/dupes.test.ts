import { describe, expect, it } from 'vitest';
import type { EnrichedEntry } from './api.js';
import { rankKeeper } from './dupes.js';
import type { MediaMeta } from './media.js';

const entry = (rel: string, meta: MediaMeta, extra: Partial<EnrichedEntry> = {}): EnrichedEntry => ({
  root: 'media',
  rel,
  name: rel.split('/').pop()!,
  kind: 'photo',
  size: 1000,
  mtimeMs: 0,
  meta,
  resolved: null,
  issues: [],
  ...extra,
});

describe('rankKeeper', () => {
  it('keeps the largest picture over a social-media copy', () => {
    const original = entry('IMG_0001.jpg', { width: 4000, height: 3000 });
    const copy = entry('IMG-20261008-WA0001.jpg', { width: 1600, height: 1200, dateTimeOriginal: '2026:10:08 09:39:00' }, { size: 5000 });
    expect(rankKeeper([copy, original])).toBe('IMG_0001.jpg');
  });

  it('at equal size prefers capture date, offset and GPS', () => {
    const bare = entry('a.jpg', { width: 100, height: 100 });
    const dated = entry('b.jpg', { width: 100, height: 100, dateTimeOriginal: '2026:10:08 09:39:00' });
    const full = entry('c.jpg', { width: 100, height: 100, dateTimeOriginal: '2026:10:08 09:39:00', offsetTimeOriginal: '+03:00' });
    expect(rankKeeper([bare, dated])).toBe('b.jpg');
    expect(rankKeeper([bare, dated, full])).toBe('c.jpg');
  });

  it('for byte-identical copies prefers the templated name, then the shallower path', () => {
    const off = entry('Trips/IMG_0001.jpg', {}, { issues: [{ id: 'nameOffTemplate', category: 'name', message: '' }] });
    const named = entry('Trips/Deep/20261008_093900_PIC.jpg', {});
    const shallow = entry('20261008_093900_PIC.jpg', {});
    expect(rankKeeper([off, named])).toBe('Trips/Deep/20261008_093900_PIC.jpg');
    expect(rankKeeper([off, named, shallow])).toBe('20261008_093900_PIC.jpg');
  });
});
