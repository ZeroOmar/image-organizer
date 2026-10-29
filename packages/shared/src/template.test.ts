import { describe, expect, it } from 'vitest';
import { defaultSettings } from './settings.js';
import { matchesTemplate, parseTemplate, planRenames, previewTemplate, type RenameInput } from './template.js';

const settings = defaultSettings();

const input = (id: string, name: string, t: [number, number, number], ms = 0, dir = 'a'): RenameInput => ({
  id,
  dir,
  name,
  kind: name.endsWith('.mp4') ? 'video' : 'photo',
  sortKey: Date.UTC(2026, 9, 8, t[0], t[1], t[2], ms),
  ctx: {
    local: { y: 2026, M: 10, d: 8, h: t[0], m: t[1], s: t[2], ms },
    offset: '+03:00',
    typeLabel: name.endsWith('.mp4') ? 'VID' : 'PIC',
    orig: name.replace(/\.[^.]+$/, ''),
    folder: dir,
  },
});

describe('parseTemplate', () => {
  it('accepts the default', () => {
    expect(parseTemplate(settings.rename.templates.photo).errors).toEqual([]);
  });
  it.each([
    ['{YYYY}/{MM}', 'Illegal'],
    ['{FOO}_{YYYY}', 'Unknown token'],
    ['plain', 'date token'],
    ['', 'empty'],
  ])('rejects %s', (t, msg) => {
    expect(parseTemplate(t).errors.join(' ')).toContain(msg);
  });
});

describe('planRenames', () => {
  it('leaves unique names without a counter', () => {
    const out = planRenames([input('1', 'IMG-1.jpeg', [9, 39, 0])], new Map(), settings);
    expect(out.get('1')).toBe('20261008_093900_PIC.jpg');
  });

  it('numbers every file that shares a second, from 01, ordered by sub-second', () => {
    const files = [input('b', 'b.jpg', [9, 40, 4], 500), input('a', 'a.jpg', [9, 40, 4], 100), input('c', 'c.jpg', [9, 40, 4], 900)];
    const out = planRenames(files, new Map(), settings);
    expect([out.get('a'), out.get('b'), out.get('c')]).toEqual([
      '20261008_09400401_PIC.jpg',
      '20261008_09400402_PIC.jpg',
      '20261008_09400403_PIC.jpg',
    ]);
  });

  it('numbers around existing files that are not in the batch', () => {
    const existing = new Map([['a', new Set(['20261008_093900_pic.jpg', '20261008_09390001_pic.jpg'])]]);
    const out = planRenames([input('1', 'x.jpg', [9, 39, 0])], existing, settings);
    expect(out.get('1')).toBe('20261008_09390002_PIC.jpg');
  });

  it('keeps photos and videos apart through the type label', () => {
    const out = planRenames([input('p', 'p.jpg', [9, 0, 0]), input('v', 'v.mp4', [9, 0, 0])], new Map(), settings);
    expect(out.get('p')).toBe('20261008_090000_PIC.jpg');
    expect(out.get('v')).toBe('20261008_090000_VID.mp4');
  });

  it('respects counter digits and start', () => {
    const s = { ...settings, rename: { ...settings.rename, counter: { digits: 3, start: 0 } } };
    const out = planRenames([input('1', '1.jpg', [1, 2, 3]), input('2', '2.jpg', [1, 2, 3], 1)], new Map(), s);
    expect(out.get('1')).toBe('20261008_010203000_PIC.jpg');
  });

  it('appends the counter when the template has no {XX}', () => {
    const out = planRenames([input('1', '1.jpg', [1, 2, 3]), input('2', '2.jpg', [1, 2, 3], 1)], new Map(), settings, {
      photo: '{YYYY}-{MM}-{DD}',
    });
    expect(out.get('2')).toBe('2026-10-08_02.jpg');
  });
});

describe('matchesTemplate', () => {
  const ctx = input('1', 'x.jpg', [9, 40, 4]).ctx;
  it('matches with and without a counter', () => {
    expect(matchesTemplate('20261008_094004_PIC.jpg', 'photo', ctx, settings)).toBe(true);
    expect(matchesTemplate('20261008_09400403_PIC.jpg', 'photo', ctx, settings)).toBe(true);
  });
  it('rejects other names and un-normalized extensions', () => {
    expect(matchesTemplate('IMG-20261008-WA0001.jpg', 'photo', ctx, settings)).toBe(false);
    expect(matchesTemplate('20261008_094004_PIC.jpeg', 'photo', ctx, settings)).toBe(false);
  });
});

it('previews templates', () => {
  expect(previewTemplate(settings.rename.templates.video, 'video', settings, '01')).toBe('20261008_09400401_VID.mp4');
});
