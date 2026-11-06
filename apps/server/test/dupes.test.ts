/**
 * Duplicate finder end to end: exact (SHA-256) and near-identical (dHash) scans over generated media,
 * the hash cache, and groups dropping files that a trash job removed (and getting them back on undo).
 * The CLIP "similar" scan downloads a ~90 MB model, so it only runs with IO_TEST_CLIP=1.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DupeScan, DupeScanRequest, JobInfo } from '@io/shared';
import { createContext } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/load.js';
import type { AppContext } from '../src/context.js';
import { buildApp } from '../src/http/app.js';

let tmp: string;
let ctx: AppContext;
let app: FastifyInstance;
let cookie = '';

const ffmpeg = (...args: string[]) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);

async function api<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  const res = await app.inject({ method, url, payload: body as object, headers: { cookie, 'x-requested-with': 'image-organizer' } });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

async function waitJob(id: string): Promise<JobInfo> {
  for (;;) {
    const j = await api<JobInfo>('GET', `/api/jobs/${id}`);
    if (j.status !== 'queued' && j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function scan(mode: DupeScanRequest['mode'], threshold?: number): Promise<DupeScan> {
  await api('POST', '/api/dupes/scan', { folder: { root: 'media', rel: 'Album' }, recursive: true, mode, threshold });
  for (;;) {
    const s = await api<DupeScan>('GET', '/api/dupes/scan');
    if (s.status !== 'running') return s;
    await new Promise((r) => setTimeout(r, 50));
  }
}

const rels = (s: DupeScan) => s.groups!.map((g) => g.files.map((f) => f.rel).sort());
const media = (...p: string[]) => path.join(tmp, 'media', ...p);

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'io-dupes-'));
  fs.mkdirSync(media('Album', 'Sub'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'import'));
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=1600x1200', '-frames:v', '1', '-q:v', '2', media('Album', 'photo.jpg'));
  fs.copyFileSync(media('Album', 'photo.jpg'), media('Album', 'Sub', 'copy.jpg'));
  // A social-media style copy: smaller and recompressed, so not byte-identical.
  ffmpeg('-i', media('Album', 'photo.jpg'), '-vf', 'scale=800:600', '-q:v', '12', media('Album', 'small.jpg'));
  ffmpeg('-f', 'lavfi', '-i', 'mandelbrot=s=1600x1200', '-frames:v', '1', media('Album', 'other.jpg'));
  ffmpeg('-f', 'lavfi', '-i', 'testsrc=s=320x240:d=1:r=15', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', media('Album', 'clip.mp4'));
  fs.copyFileSync(media('Album', 'clip.mp4'), media('Album', 'Sub', 'clip copy.mp4'));

  const bcrypt = (await import('bcryptjs')).default;
  const { config, appDir } = loadConfig({
    APP_DIR: path.join(tmp, 'app'),
    APP_CONFIG: JSON.stringify({
      admin: { username: 'admin', passwordHash: bcrypt.hashSync('pw', 4) },
      session: { secret: 'test-secret-0123456789' },
      media: { root: path.join(tmp, 'media') },
      import: { root: path.join(tmp, 'import') },
      trash: { root: path.join(tmp, 'trash') },
    }),
  });
  ctx = createContext(config, appDir);
  app = await buildApp(ctx, { logger: false });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'pw' }, headers: { 'x-requested-with': 'image-organizer' } });
  cookie = String(login.headers['set-cookie']).split(';')[0];
}, 60_000);

afterAll(async () => {
  await app?.close();
  await ctx?.metadata.close();
  ctx?.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('duplicate finder', () => {
  it('exact: groups byte-identical photos and videos and keeps the shallower copy', async () => {
    const s = await scan('exact');
    expect(s.status).toBe('done');
    expect(s.fileCount).toBe(6);
    expect(rels(s)).toEqual(
      expect.arrayContaining([
        ['Album/Sub/copy.jpg', 'Album/photo.jpg'],
        ['Album/Sub/clip copy.mp4', 'Album/clip.mp4'],
      ]),
    );
    expect(s.groups).toHaveLength(2);
    expect(s.groups!.find((g) => g.files.some((f) => f.rel === 'Album/photo.jpg'))!.keep).toBe('Album/photo.jpg');
  });

  it('near: also finds the resized copy, keeps the full-size original, ignores videos', async () => {
    const s = await scan('near');
    expect(s.fileCount).toBe(4);
    expect(rels(s)).toEqual([['Album/Sub/copy.jpg', 'Album/photo.jpg', 'Album/small.jpg']]);
    expect(s.groups![0].keep).toBe('Album/photo.jpg');
    expect(s.groups![0].similarity).toBeGreaterThan(0.9);
    // A stricter threshold regroups without rescanning.
    const strict = await api<DupeScan>('GET', '/api/dupes/scan?threshold=0');
    expect(strict.threshold).toBe(0);
  });

  it('reuses cached hashes until the file is invalidated', async () => {
    const ref = { root: 'media', rel: 'Album/small.jpg' };
    ctx.db.prepare("UPDATE media_hash SET dhash = '0000000000000000' WHERE root = ? AND rel = ?").run(ref.root, ref.rel);
    expect(rels(await scan('near'))).toEqual([['Album/Sub/copy.jpg', 'Album/photo.jpg']]);
    ctx.indexer.invalidate(ref);
    expect(rels(await scan('near'))).toEqual([['Album/Sub/copy.jpg', 'Album/photo.jpg', 'Album/small.jpg']]);
  });

  it('drops trashed files from the groups and brings them back on undo', async () => {
    await scan('exact');
    const job = await waitJob(
      (await api<JobInfo>('POST', '/api/jobs', { selection: { files: [{ root: 'media', rel: 'Album/Sub/copy.jpg' }] }, steps: [{ type: 'trash' }] })).id,
    );
    expect(job.status).toBe('done');
    expect(rels(await api<DupeScan>('GET', '/api/dupes/scan'))).toEqual([['Album/Sub/clip copy.mp4', 'Album/clip.mp4']]);
    await waitJob((await api<JobInfo>('POST', `/api/jobs/${job.id}/undo`)).id);
    expect(await api<DupeScan>('GET', '/api/dupes/scan').then((s) => s.groups!.length)).toBe(2);
  });

  it('rejects a second scan while one runs, and can cancel', async () => {
    await api('POST', '/api/dupes/scan', { folder: { root: 'media', rel: '' }, mode: 'exact' });
    await expect(api('POST', '/api/dupes/scan', { folder: { root: 'media', rel: '' }, mode: 'exact' })).rejects.toThrow(/409/);
    await api('POST', '/api/dupes/cancel');
    for (;;) {
      const s = await api<DupeScan>('GET', '/api/dupes/scan');
      if (s.status !== 'running') {
        expect(['cancelled', 'done']).toContain(s.status);
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it.runIf(process.env.IO_TEST_CLIP === '1')(
    'similar: groups the same scene by CLIP embedding',
    async () => {
      const s = await scan('similar');
      expect(s.status).toBe('done');
      expect(rels(s)[0]).toEqual(expect.arrayContaining(['Album/photo.jpg', 'Album/small.jpg']));
      expect(rels(s).flat()).not.toContain('Album/other.jpg');
    },
    300_000,
  );
});
