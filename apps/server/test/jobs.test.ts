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
