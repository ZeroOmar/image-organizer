/**
 * Integration tests: real ExifTool against copies of fixtures/media in a temp dir.
 * Needs exiftool + ffmpeg on PATH (same as scripts/run-local.sh).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FolderListing, JobInfo, JobRequest, PlanResult } from '@io/shared';
import { createContext } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/load.js';
import type { AppContext } from '../src/context.js';
import { buildApp } from '../src/http/app.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let tmp: string;
let ctx: AppContext;
let app: FastifyInstance;
let cookie = '';

const exif = (file: string, ...tags: string[]) =>
  JSON.parse(execFileSync('exiftool', ['-j', '-n', ...tags.map((t) => `-${t}`), file], { encoding: 'utf8' }))[0];

async function api<T>(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown): Promise<T> {
  const res = await app.inject({
    method,
    url,
    payload: body as object,
    headers: { cookie, 'x-requested-with': 'image-organizer' },
  });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

async function runJob(req: JobRequest): Promise<JobInfo> {
  const job = await api<JobInfo>('POST', '/api/jobs', req);
  return waitJob(job.id);
}

async function waitJob(id: string): Promise<JobInfo> {
  for (;;) {
    const j = await api<JobInfo>('GET', `/api/jobs/${id}`);
    if (j.status !== 'queued' && j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 50));
  }
}

const media = (...p: string[]) => path.join(tmp, 'media', ...p);

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'io-it-'));
  fs.cpSync(path.join(repo, 'fixtures/media'), path.join(tmp, 'media'), { recursive: true, preserveTimestamps: true });
  fs.cpSync(path.join(repo, 'fixtures/import'), path.join(tmp, 'import'), { recursive: true, preserveTimestamps: true });
  const bcrypt = (await import('bcryptjs')).default;
  const hash = bcrypt.hashSync('pw', 4);
  const { config, appDir } = loadConfig({
    APP_DIR: path.join(tmp, 'app'),
    APP_CONFIG: JSON.stringify({
      admin: { username: 'admin', passwordHash: hash },
      session: { secret: 'test-secret-0123456789' },
      media: { root: path.join(tmp, 'media') },
      import: { root: path.join(tmp, 'import') },
      trash: { root: path.join(tmp, 'trash') },
      timezone: { default: 'Africa/Cairo' },
    }),
  });
  ctx = createContext(config, appDir);
  app = await buildApp(ctx, { logger: false });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: 'pw' },
    headers: { 'x-requested-with': 'image-organizer' },
  });
  expect(login.statusCode).toBe(200);
  cookie = String(login.headers['set-cookie']).split(';')[0];
});

afterAll(async () => {
  await app?.close();
  await ctx?.metadata.close();
  ctx?.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('auth', () => {
  it('rejects unauthenticated and CSRF-less requests', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/jobs', headers: { cookie }, payload: {} })).statusCode).toBe(403);
  });
  it('blocks path traversal', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/folder?root=media&rel=../../etc', headers: { cookie } });
    expect(res.statusCode).toBe(400);
  });
});

describe('folder listing', () => {
  it('resolves dates and flags issues', async () => {
    const l = await api<FolderListing>('GET', '/api/folder?root=media&rel=Trips/Bikers');
    const by = Object.fromEntries(l.entries.map((e) => [e.name, e]));
    expect(by['IMG_0001.jpg'].resolved).toMatchObject({ source: 'original', offset: '+03:00', tzSource: 'offset' });
    expect(by['burst_a.jpg'].resolved).toMatchObject({ tz: 'Africa/Cairo', tzSource: 'gps' });
    expect(by['clip.mp4'].resolved?.local).toMatchObject({ h: 9, m: 41 });
    const wa = by['IMG-20261008-WA0001.jpeg'];
    expect(wa.resolved).toMatchObject({ source: 'filename', timeFrom: 'fileModify' });
    expect(wa.issues.map((i) => i.id)).toEqual(expect.arrayContaining(['missingOriginalDate', 'missingGps', 'missingCamera']));
    expect(by['DSC_0420.jpg'].issues.map((i) => i.id)).toContain('dateMismatchFile');
  });
});

describe('jobs', () => {
  it('dry-run renames the folder Bridge-style without touching files', async () => {
    const plan = await api<PlanResult>('POST', '/api/jobs/plan', {
      selection: { folder: { root: 'media', rel: 'Trips/Bikers' } },
      steps: [{ type: 'rename' }],
    });
    const after = Object.fromEntries(plan.items.map((i) => [i.before, i.after]));
    expect(after['IMG_0001.jpg']).toBe('20261008_093900_PIC.jpg');
    expect([after['burst_a.jpg'], after['burst_b.jpg'], after['burst_c.jpg']]).toEqual([
      '20261008_09400401_PIC.jpg',
      '20261008_09400402_PIC.jpg',
      '20261008_09400403_PIC.jpg',
    ]);
    expect(after['clip.mp4']).toBe('20261008_094100_VID.mp4');
    expect(after['Screenshot 2026-10-08 at 10.15.00.png']).toBe('20261008_101500_PIC.png');
    expect(fs.existsSync(media('Trips/Bikers/burst_a.jpg'))).toBe(true);
  });

  it('writes resolved dates, then undoes', async () => {
    const file = media('Trips/Bikers/IMG-20261008-WA0001.jpeg');
    const job = await runJob({ selection: { files: [{ root: 'media', rel: 'Trips/Bikers/IMG-20261008-WA0001.jpeg' }] }, steps: [{ type: 'applyDates' }] });
    expect(job.status).toBe('done');
    expect(exif(file, 'DateTimeOriginal', 'OffsetTimeOriginal')).toMatchObject({ DateTimeOriginal: '2026:10:08 15:15:30', OffsetTimeOriginal: '+03:00' });
    const undo = await api<JobInfo>('POST', `/api/jobs/${job.id}/undo`);
    expect((await waitJob(undo.id)).status).toBe('done');
    expect(exif(file, 'DateTimeOriginal').DateTimeOriginal).toBeUndefined();
  });

  it('sets GPS on photos and videos', async () => {
    const job = await runJob({
      selection: { files: [{ root: 'media', rel: 'Trips/Bikers/DSC_0420.jpg' }, { root: 'media', rel: 'Trips/Bikers/MOV_0001.mov' }] },
      steps: [{ type: 'setGps', lat: -33.8568, lon: 151.2153, alt: 12 }],
    });
    expect(job.errors).toEqual([]);
    expect(exif(media('Trips/Bikers/DSC_0420.jpg'), 'GPSLatitude', 'GPSLongitude')).toMatchObject({ GPSLatitude: -33.8568, GPSLongitude: 151.2153 });
    expect(exif(media('Trips/Bikers/MOV_0001.mov'), 'GPSLatitude').GPSLatitude).toBeCloseTo(-33.8568, 3);
    await waitJob((await api<JobInfo>('POST', `/api/jobs/${job.id}/undo`)).id);
    expect(exif(media('Trips/Bikers/DSC_0420.jpg'), 'GPSLatitude').GPSLatitude).toBeUndefined();
    expect(exif(media('Trips/Bikers/MOV_0001.mov'), 'GPSLatitude').GPSLatitude).toBeUndefined();
  });

  it('repairs a dangling EXIF image pointer ("Error reading OtherImageStart data in IFD0") and sets GPS', async () => {
    // IFD0 with Make plus OtherImageStart/Length pointing far past the end of the file.
    const make = Buffer.from('Phone\0');
    const ifd = Buffer.alloc(2 + 3 * 12 + 4);
    ifd.writeUInt16LE(3, 0);
    [
      [0x010f, 2, make.length, 8 + ifd.length],
      [0x0201, 4, 1, 500_000],
      [0x0202, 4, 1, 20_000],
    ].forEach(([tag, type, count, value], i) => {
      ifd.writeUInt16LE(tag, 2 + i * 12);
      ifd.writeUInt16LE(type, 4 + i * 12);
      ifd.writeUInt32LE(count, 6 + i * 12);
      ifd.writeUInt32LE(value, 10 + i * 12);
    });
    const app1 = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('II*\0'), Buffer.from([8, 0, 0, 0]), ifd, make]);
    const head = Buffer.from([0xff, 0xe1, 0, 0]);
    head.writeUInt16BE(app1.length + 2, 2);
    const jpg = execFileSync('exiftool', ['-all=', '-o', '-', media('Trips/Bikers/DSC_0420.jpg')]);
    const rel = 'Trips/Bikers/broken_pointer.jpg';
    fs.writeFileSync(media(rel), Buffer.concat([jpg.subarray(0, 2), head, app1, jpg.subarray(2)]));
    expect(() => execFileSync('exiftool', ['-o', path.join(tmp, 'probe.jpg'), '-GPSLatitude=1', media(rel)], { stdio: 'pipe' })).toThrow(/OtherImageStart/);

    const job = await runJob({ selection: { files: [{ root: 'media', rel }] }, steps: [{ type: 'setGps', lat: 1.5, lon: 2.5 }] });
    expect(job.errors).toEqual([]);
    expect(job.notes[0].message).toMatch(/^Repaired broken EXIF/);
    expect(exif(media(rel), 'Make', 'GPSLatitude', 'GPSLongitude', 'OtherImageStart')).toMatchObject({ Make: 'Phone', GPSLatitude: 1.5, GPSLongitude: 2.5 });
    expect(exif(media(rel), 'OtherImageStart').OtherImageStart).toBeUndefined();
    await waitJob((await api<JobInfo>('POST', `/api/jobs/${job.id}/undo`)).id);
    expect(exif(media(rel), 'GPSLatitude').GPSLatitude).toBeUndefined();
    fs.rmSync(media(rel));
  });

  it('undo restores previous GPS values', async () => {
    const rel = 'Trips/Bikers/IMG_0001.jpg';
    const job = await runJob({ selection: { files: [{ root: 'media', rel }] }, steps: [{ type: 'setGps', lat: 1, lon: 2 }] });
    expect(exif(media(rel), 'GPSLatitude').GPSLatitude).toBe(1);
    await waitJob((await api<JobInfo>('POST', `/api/jobs/${job.id}/undo`)).id);
    expect(exif(media(rel), 'GPSLatitude').GPSLatitude).toBeCloseTo(31.2001, 4);
  });

  it('tightens a GPS cluster toward a center, skipping files already there, then undoes', async () => {
    const files = ['IMG_0001.jpg', 'burst_a.jpg', 'DSC_0420.jpg'].map((f) => ({ root: 'media' as const, rel: `Trips/Bikers/${f}` }));
    const step = { type: 'gatherGps' as const, lat: 30.0444, lon: 31.2357, scale: 0.5 };
    const plan = await api<PlanResult>('POST', '/api/jobs/plan', { selection: { files }, steps: [step] });
    // burst_a sits on the center and DSC_0420 has no GPS: only IMG_0001 moves.
    expect(plan.items.map((i) => i.file.rel)).toEqual(['Trips/Bikers/IMG_0001.jpg']);
    const job = await runJob({ selection: { files }, steps: [step] });
    expect(job.errors).toEqual([]);
    const moved = exif(media('Trips/Bikers/IMG_0001.jpg'), 'GPSLatitude', 'GPSLongitude');
    expect(moved.GPSLatitude).toBeCloseTo((31.2001 + 30.0444) / 2, 4);
    expect(moved.GPSLongitude).toBeCloseTo((29.9187 + 31.2357) / 2, 4);
    await waitJob((await api<JobInfo>('POST', `/api/jobs/${job.id}/undo`)).id);
    expect(exif(media('Trips/Bikers/IMG_0001.jpg'), 'GPSLatitude').GPSLatitude).toBeCloseTo(31.2001, 4);
  });

  it('edits group-qualified tags from the All tags panel and undoes them', async () => {
    const rel = 'Trips/Bikers/DSC_0420.jpg';
    const job = await runJob({
      selection: { files: [{ root: 'media', rel }] },
      steps: [{ type: 'editTags', tags: { 'ExifIFD:DateTimeOriginal': '2026:10:08 11:00:00', 'XMP-dc:Subject': ['bikes', 'trip'], 'IFD0:Model': 'EOS R5' } }],
    });
    expect(job.errors).toEqual([]);
    expect(exif(media(rel), 'DateTimeOriginal', 'Subject', 'Model')).toMatchObject({
      DateTimeOriginal: '2026:10:08 11:00:00',
      Subject: ['bikes', 'trip'],
      Model: 'EOS R5',
    });
    await waitJob((await api<JobInfo>('POST', `/api/jobs/${job.id}/undo`)).id);
    const after = exif(media(rel), 'DateTimeOriginal', 'Subject', 'Model');
    expect(after).toMatchObject({ DateTimeOriginal: '2026:10:08 10:09:40', Model: 'EOS R6' });
    expect(after.Subject).toBeUndefined();
  });

  it('reports non-writable tags as job errors', async () => {
    const job = await runJob({
      selection: { files: [{ root: 'media', rel: 'Trips/Bikers/DSC_0420.jpg' }] },
      steps: [{ type: 'editTags', tags: { 'Composite:ImageSize': '1x1' } }],
    });
    expect(job.errors.length).toBe(1);
  });

  it('copies selected metadata groups', async () => {
    const job = await runJob({
      selection: { files: [{ root: 'media', rel: 'Trips/Bikers/IMG-20261008-WA0001.jpeg' }] },
      steps: [{ type: 'copyMetadata', source: { root: 'media', rel: 'Trips/Bikers/IMG_0001.jpg' }, groups: ['camera', 'gps'], tags: [] }],
    });
    expect(job.errors).toEqual([]);
    expect(exif(media('Trips/Bikers/IMG-20261008-WA0001.jpeg'), 'Make', 'GPSLatitude')).toMatchObject({ Make: 'INFINIX', GPSLatitude: 31.2001 });
  });

  it('renames, keeps numbering stable when re-run, and undoes', async () => {
    const sel = { folder: { root: 'media' as const, rel: 'Trips/Bikers' } };
    const job = await runJob({ selection: sel, steps: [{ type: 'rename' }] });
    expect(job.errors).toEqual([]);
    const names = fs.readdirSync(media('Trips/Bikers')).sort();
    expect(names).toContain('20261008_09400402_PIC.jpg');
    expect(names).toContain('20261008_094100_VID.mp4');
    const again = await api<PlanResult>('POST', '/api/jobs/plan', { selection: sel, steps: [{ type: 'rename' }] });
    expect(again.items.filter((i) => !i.error)).toEqual([]);
    await waitJob((await api<JobInfo>('POST', `/api/jobs/${job.id}/undo`)).id);
    expect(fs.existsSync(media('Trips/Bikers/burst_b.jpg'))).toBe(true);
  });

  it('trashes to the separate trash root and restores', async () => {
    const job = await runJob({ selection: { files: [{ root: 'media', rel: 'Family/20260901_183500_PIC.jpg' }] }, steps: [{ type: 'trash' }] });
    expect(job.status).toBe('done');
    expect(fs.existsSync(path.join(tmp, 'trash/media/Family/20260901_183500_PIC.jpg'))).toBe(true);
    const [item] = await api<{ id: number }[]>('GET', '/api/trash');
    await api('POST', '/api/trash/restore', { ids: [item.id] });
    expect(fs.existsSync(media('Family/20260901_183500_PIC.jpg'))).toBe(true);
  });

  it('converts HEIC to JPG keeping metadata and mtime, skips other files, then undoes', async () => {
    const heic = media('Family/IMG_2001.HEIC');
    const before = exif(heic, 'DateTimeOriginal', 'GPSLatitude', 'Make', 'ImageWidth');
    const mtime = fs.statSync(heic).mtimeMs;
    const req: JobRequest = { selection: { folder: { root: 'media', rel: 'Family' } }, steps: [{ type: 'heicToJpeg', quality: 85 }] };
    const plan = await api<PlanResult>('POST', '/api/jobs/plan', req);
    expect(plan.items.map((i) => i.after)).toEqual(['IMG_2001.jpg (quality 85)']);
    expect(plan.warnings).toEqual(['1 file(s) skipped: not HEIC/HEIF']);

    const job = await runJob(req);
    expect(job.errors).toEqual([]);
    const jpg = media('Family/IMG_2001.jpg');
    expect(fs.existsSync(heic)).toBe(false);
    expect(fs.readFileSync(jpg).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(exif(jpg, 'DateTimeOriginal', 'GPSLatitude', 'Make', 'ImageWidth')).toEqual({ ...before, SourceFile: jpg });
    expect(exif(jpg, 'Orientation').Orientation).toBeUndefined();
    expect(Math.trunc(fs.statSync(jpg).mtimeMs)).toBe(Math.trunc(mtime));

    await waitJob((await api<JobInfo>('POST', `/api/jobs/${job.id}/undo`)).id);
    expect(fs.existsSync(heic)).toBe(true);
    expect(fs.existsSync(jpg)).toBe(false);
  });

  const thumbSize = async (rel: string) => {
    const res = await app.inject({ method: 'GET', url: `/api/thumb?root=media&rel=${encodeURIComponent(rel)}&size=128`, headers: { cookie } });
    expect(res.statusCode, rel).toBe(200);
    const m = await sharp(res.rawPayload).metadata();
    return `${m.width}x${m.height}`;
  };
  const undo = async (job: JobInfo) => expect((await waitJob((await api<JobInfo>('POST', `/api/jobs/${job.id}/undo`)).id)).errors).toEqual([]);

  it('rotates a JPEG via EXIF Orientation keeping mtime, refreshes the thumbnail, then undoes', async () => {
    const rel = 'Trips/Bikers/IMG_0001.jpg';
    const file = media(rel);
    const mtime = fs.statSync(file).mtimeMs;
    expect(exif(file, 'Orientation').Orientation).toBeUndefined();
    expect(await thumbSize(rel)).toBe('128x96');

    const req: JobRequest = { selection: { files: [{ root: 'media', rel }] }, steps: [{ type: 'rotate', degrees: 90 }, { type: 'rotate', degrees: 90 }, { type: 'rotate', degrees: 270 }] };
    const plan = await api<PlanResult>('POST', '/api/jobs/plan', req);
    expect(plan.items.map((i) => `${i.before} → ${i.after}`)).toEqual([
      'Normal → Rotated 90° right',
      'Rotated 90° right → Rotated 180°',
      'Rotated 180° → Rotated 90° right',
    ]);
    const job = await runJob(req);
    expect(job.errors).toEqual([]);
    expect(exif(file, 'Orientation').Orientation).toBe(6);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
    // Same path, mtime and (often) size as before: the cache key must still change.
    expect(await thumbSize(rel)).toBe('96x128');
    const l = await api<FolderListing>('GET', '/api/folder?root=media&rel=Trips/Bikers');
    expect(l.entries.find((e) => e.name === 'IMG_0001.jpg')?.meta.orientation).toBe(6);

    await undo(job);
    expect(exif(file, 'Orientation').Orientation).toBeUndefined();
    expect(await thumbSize(rel)).toBe('128x96');
  });

  it('mirrors a selfie with no EXIF and clears the front-camera issue, then undoes', async () => {
    const rel = 'Trips/Bikers/IMG-20261008-WA0001.jpeg';
    const file = media(rel);
    const sel = { files: [{ root: 'media' as const, rel }] };
    const issues = async () =>
      (await api<FolderListing>('GET', '/api/folder?root=media&rel=Trips/Bikers')).entries.find((e) => e.rel === rel)!.issues.map((i) => i.id);
    const lens = await runJob({ selection: sel, steps: [{ type: 'editTags', tags: { LensModel: 'iPhone 15 front camera 2.69mm f/1.9' } }] });
    expect(await issues()).toContain('frontCamera');

    const job = await runJob({ selection: sel, steps: [{ type: 'mirror', axis: 'horizontal' }] });
    expect(job.errors).toEqual([]);
    expect(exif(file, 'Orientation').Orientation).toBe(2);
    expect(await issues()).not.toContain('frontCamera');

    await undo(job);
    expect(exif(file, 'Orientation').Orientation).toBeUndefined();
    await undo(lens);
    expect(await issues()).not.toContain('frontCamera');
  });

  it('rotates HEIC via irot and videos via the track matrix; mirroring skips both', async () => {
    const sel = { files: [{ root: 'media' as const, rel: 'Family/IMG_2001.HEIC' }, { root: 'media' as const, rel: 'Trips/Bikers/clip.mp4' }] };
    const mirror = await api<PlanResult>('POST', '/api/jobs/plan', { selection: sel, steps: [{ type: 'mirror', axis: 'horizontal' }] });
    expect(mirror.items).toEqual([]);
    expect(mirror.warnings).toEqual([
      "1 HEIC file(s) skipped: HEIC can't be mirrored losslessly; convert to JPG first",
      "1 video(s) skipped: videos can't be mirrored",
    ]);

    const job = await runJob({ selection: sel, steps: [{ type: 'rotate', degrees: 90 }] });
    expect(job.errors).toEqual([]);
    expect(exif(media('Family/IMG_2001.HEIC'), 'QuickTime:Rotation').Rotation).toBe(3);
    expect(exif(media('Trips/Bikers/clip.mp4'), 'Rotation').Rotation).toBe(90);
    expect(await thumbSize('Family/IMG_2001.HEIC')).toBe('96x128');
    expect(await thumbSize('Trips/Bikers/clip.mp4')).toBe('96x128');
    const l = await api<FolderListing>('GET', '/api/folder?root=media&rel=Family');
    expect(l.entries.find((e) => e.name === 'IMG_2001.HEIC')?.meta.rotation).toBe(90);

    await undo(job);
    expect(exif(media('Family/IMG_2001.HEIC'), 'QuickTime:Rotation').Rotation).toBe(0);
    expect(exif(media('Trips/Bikers/clip.mp4'), 'Rotation').Rotation).toBe(0);
  });

  it('mirrors HEIC by converting it to JPG first in the same job, then undoes', async () => {
    const heic = media('Family/IMG_2001.HEIC');
    const job = await runJob({
      selection: { files: [{ root: 'media', rel: 'Family/IMG_2001.HEIC' }] },
      steps: [{ type: 'heicToJpeg' }, { type: 'mirror', axis: 'horizontal' }],
    });
    expect(job.errors).toEqual([]);
    expect(exif(media('Family/IMG_2001.jpg'), 'Orientation').Orientation).toBe(2);
    await undo(job);
    expect(fs.existsSync(heic)).toBe(true);
    expect(fs.existsSync(media('Family/IMG_2001.jpg'))).toBe(false);
  });

  it('imports into an album with dates + rename', async () => {
    await api('POST', '/api/folders', { root: 'media', rel: '', name: 'Album' });
    const job = await runJob({
      selection: { folder: { root: 'import', rel: 'Phone' } },
      steps: [{ type: 'applyDates' }, { type: 'move', dest: { root: 'media', rel: 'Album' } }, { type: 'rename' }],
    });
    expect(job.errors).toEqual([]);
    const album = fs.readdirSync(media('Album'));
    expect(album).toHaveLength(2);
    expect(album).toEqual(expect.arrayContaining(['20261009_120000_PIC.jpg', expect.stringMatching(/^20261009_\d{6}_VID\.mp4$/)]));
    expect(fs.readdirSync(path.join(tmp, 'import/Phone'))).toEqual([]);
  });

  it('serves thumbnails for jpeg, heic and video', async () => {
    for (const rel of ['Trips/Bikers/IMG_0001.jpg', 'Family/IMG_2001.HEIC', 'Trips/Bikers/clip.mp4']) {
      const res = await app.inject({ method: 'GET', url: `/api/thumb?root=media&rel=${encodeURIComponent(rel)}&size=128`, headers: { cookie } });
      expect(res.statusCode, rel).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
    }
  });

  // Phone HEICs are tile grids; ffmpeg rejects -vf on the filtergraph it builds for them. sips tiles large images.
  const hasSips = (() => {
    try {
      execFileSync('which', ['sips']);
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!hasSips)('thumbnails and previews a tiled, rotated HEIC upright', async () => {
    fs.mkdirSync(media('Grid'));
    const src = media('Grid/src.jpg');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1600x1200', '-frames:v', '1', src]);
    execFileSync('sips', ['-s', 'format', 'heic', src, '--out', media('Grid/IMG_3001.HEIC')]);
    fs.rmSync(src);
    execFileSync('exiftool', ['-q', '-overwrite_original', '-Rotation=90', media('Grid/IMG_3001.HEIC')]);
    for (const url of ['/api/thumb?root=media&rel=Grid/IMG_3001.HEIC&size=128', '/api/file?root=media&rel=Grid/IMG_3001.HEIC']) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode, `${url} ${res.body.slice(0, 200)}`).toBe(200);
      const { width, height } = await sharp(res.rawPayload).metadata();
      expect(height, url).toBeGreaterThan(width!);
    }
    fs.rmSync(media('Grid'), { recursive: true });
  });

  it('streams byte ranges', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/file?root=media&rel=Trips/Bikers/clip.mp4',
      headers: { cookie, range: 'bytes=0-99' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.rawPayload.length).toBe(100);
  });
});
