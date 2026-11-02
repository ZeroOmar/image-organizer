/**
 * Video conversion, end to end with real ffmpeg (libx265) and ExifTool. The clips are generated here
 * (high-bitrate H.264 with Apple and Android style metadata) instead of living in fixtures/.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JobInfo, JobRequest, PlanResult, Settings } from '@io/shared';
import { createContext } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/load.js';
import type { AppContext } from '../src/context.js';
import { buildApp } from '../src/http/app.js';

let tmp: string;
let ctx: AppContext;
let app: FastifyInstance;
let cookie = '';

const exif = (file: string, ...tags: string[]) =>
  JSON.parse(execFileSync('exiftool', ['-j', '-n', '-G1', ...tags.map((t) => `-${t}`), file], { encoding: 'utf8' }))[0];
const probe = (file: string) =>
  JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,codec_tag_string,width,height,pix_fmt', '-of', 'json', file], { encoding: 'utf8' })).streams[0];
const ffmpeg = (...args: string[]) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
const et = (...args: string[]) => execFileSync('exiftool', ['-q', '-overwrite_original', ...args]);

async function api<T>(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown): Promise<T> {
  const res = await app.inject({ method, url, payload: body as object, headers: { cookie, 'x-requested-with': 'image-organizer' } });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

async function waitJob(id: string, until = (j: JobInfo) => j.status !== 'queued' && j.status !== 'running'): Promise<JobInfo> {
  for (;;) {
    const j = await api<JobInfo>('GET', `/api/jobs/${id}`);
    if (until(j)) return j;
    await new Promise((r) => setTimeout(r, 50));
  }
}

const media = (...p: string[]) => path.join(tmp, 'media', ...p);
const sel = (...rels: string[]) => ({ files: rels.map((rel) => ({ root: 'media' as const, rel })) });
const convert = (req: Omit<JobRequest, 'steps'>, crf = 28): JobRequest => ({ ...req, steps: [{ type: 'convert', crf, preset: 'ultrafast' }] });
const KEEP = ['Keys:Make', 'Keys:Model', 'Keys:CreationDate', 'Keys:GPSCoordinates', 'QuickTime:CreateDate', 'UserData:GPSCoordinates', 'XMP-xmp:Rating'];

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'io-conv-'));
  const dir = media('Phone');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'import'));
  // iPhone style: .mov, 1080p, ~20 Mbps H.264 + AAC, Keys tags, UTC QuickTime dates.
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=3:r=30', '-f', 'lavfi', '-i', 'sine=d=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '20M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'IMG_1001.mov'));
  et('-api', 'QuickTimeUTC=0', '-QuickTime:CreateDate=2026:10:08 06:41:00', '-Keys:GPSCoordinates#=31.2001 29.9187 12', '-Keys:Make=Apple', '-Keys:Model=iPhone 15 Pro', '-Keys:CreationDate=2026:10:08 09:41:00+03:00', path.join(dir, 'IMG_1001.mov'));
  // Android style: .mp4, 10-bit, UserData ©xyz GPS and an XMP rating (ffmpeg alone drops both).
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=1280x720:d=2:r=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '15M', '-pix_fmt', 'yuv420p10le', path.join(dir, 'VID_20261008.mp4'));
  et('-UserData:GPSCoordinates=30.0444, 31.2357', '-XMP:Rating=4', '-QuickTime:CreateDate=2026:10:08 07:00:00', path.join(dir, 'VID_20261008.mp4'));
  // Already HEVC, and a low-bitrate H.264: both skipped by the default settings.
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1:r=30', '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error', '-tag:v', 'hvc1', path.join(dir, 'hevc.mp4'));
  ffmpeg('-f', 'lavfi', '-i', 'color=c=gray:s=640x360:d=2:r=30', '-c:v', 'libx264', '-b:v', '300k', path.join(dir, 'low.mp4'));
  // Long enough to cancel mid-encode.
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=20:r=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '20M', path.join(dir, 'long.mp4'));
  for (const f of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, f), new Date('2026-10-08T06:41:00Z'), new Date('2026-10-08T06:41:00Z'));

  const bcrypt = (await import('bcryptjs')).default;
  const { config, appDir } = loadConfig({
    APP_DIR: path.join(tmp, 'app'),
    APP_CONFIG: JSON.stringify({
      admin: { username: 'admin', passwordHash: bcrypt.hashSync('pw', 4) },
      session: { secret: 'test-secret-0123456789' },
      media: { root: path.join(tmp, 'media') },
      import: { root: path.join(tmp, 'import') },
      trash: { root: path.join(tmp, 'trash') },
      timezone: { default: 'Africa/Cairo' },
    }),
  });
  ctx = createContext(config, appDir);
  app = await buildApp(ctx, { logger: false });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'pw' }, headers: { 'x-requested-with': 'image-organizer' } });
  cookie = String(login.headers['set-cookie']).split(';')[0];
}, 120_000);

afterAll(async () => {
  await app?.close();
  await ctx?.metadata.close();
  ctx?.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('convert', () => {
  it('reports availability and plans only worthwhile videos', async () => {
    expect((await api<{ convertAvailable: boolean }>('GET', '/api/config')).convertAvailable).toBe(true);
    const plan = await api<PlanResult>('POST', '/api/jobs/plan', convert({ selection: { folder: { root: 'media', rel: 'Phone' } } }));
    expect(plan.items.map((i) => i.file.rel).sort()).toEqual(['Phone/IMG_1001.mov', 'Phone/VID_20261008.mp4', 'Phone/long.mp4']);
    expect(plan.items.find((i) => i.file.rel === 'Phone/IMG_1001.mov')?.before).toMatch(/^H\.264 · \d+\.\d Mbps/);
    expect(plan.warnings).toEqual(['1 video(s) skipped: already HEVC/AV1', '1 video(s) skipped: below 10 Mbps']);
  });

  it('converts to HEVC keeping resolution, metadata and mtime; the original goes to the trash; undo restores it', async () => {
    const files = ['IMG_1001.mov', 'VID_20261008.mp4'];
    const before = Object.fromEntries(files.map((f) => [f, { tags: exif(media('Phone', f), ...KEEP), size: fs.statSync(media('Phone', f)).size, probe: probe(media('Phone', f)) }]));
    const submitted = await api<JobInfo>('POST', '/api/jobs', convert({ selection: sel(...files.map((f) => `Phone/${f}`)) }));
    expect(submitted.lane).toBe('convert');
    const job = await waitJob(submitted.id);
    expect(job.status).toBe('done');
    expect(job.errors).toEqual([]);
    expect(job.savedBytes).toBeGreaterThan(0);
    for (const f of files) {
      const abs = media('Phone', f);
      const p = probe(abs);
      expect(p).toMatchObject({ codec_name: 'hevc', codec_tag_string: 'hvc1', width: before[f].probe.width, height: before[f].probe.height, pix_fmt: before[f].probe.pix_fmt });
      expect(exif(abs, ...KEEP)).toEqual({ ...before[f].tags, SourceFile: abs });
      expect(fs.statSync(abs).size).toBeLessThan(before[f].size);
      expect(fs.statSync(abs).mtime.toISOString()).toBe('2026-10-08T06:41:00.000Z');
    }
    expect(fs.readdirSync(media('Phone')).filter((n) => n.startsWith('.'))).toEqual([]);
    expect(ctx.trash.list().map((t) => t.originalRel).sort()).toEqual(files.map((f) => `Phone/${f}`));
    // The index re-reads the new codec.
    expect((await ctx.indexer.getEntry({ root: 'media', rel: 'Phone/IMG_1001.mov' })).meta.videoCodec).toBe('hevc');

    const undo = await waitJob((await api<JobInfo>('POST', `/api/jobs/${job.id}/undo`)).id);
    expect(undo.status).toBe('done');
    for (const f of files) {
      expect(probe(media('Phone', f)).codec_name).toBe('h264');
      expect(fs.statSync(media('Phone', f)).size).toBe(before[f].size);
    }
    // Both converted copies are now in the trash, nothing was deleted.
    expect(ctx.trash.list().map((t) => t.originalRel).sort()).toEqual(files.map((f) => `Phone/${f}`));
  }, 120_000);

  it('keeps the original when the result is not small enough', async () => {
    const s = await api<Settings>('GET', '/api/settings');
    await api('PUT', '/api/settings', { ...s, convert: { ...s.convert, minSavingPct: 95 } });
    try {
      const size = fs.statSync(media('Phone', 'IMG_1001.mov')).size;
      const job = await waitJob((await api<JobInfo>('POST', '/api/jobs', convert({ selection: sel('Phone/IMG_1001.mov') }, 20))).id);
      expect(job.status).toBe('done');
      expect(job.undoable).toBe(false);
      expect(job.notes[0].message).toMatch(/^Kept the original/);
      expect(fs.statSync(media('Phone', 'IMG_1001.mov')).size).toBe(size);
      expect(probe(media('Phone', 'IMG_1001.mov')).codec_name).toBe('h264');
    } finally {
      await api('PUT', '/api/settings', s);
    }
  }, 120_000);

  it('cancels a running encode without touching the original, while main-lane jobs keep running', async () => {
    const size = fs.statSync(media('Phone', 'long.mp4')).size;
    const conv = await api<JobInfo>('POST', '/api/jobs', { selection: sel('Phone/long.mp4'), steps: [{ type: 'convert', crf: 18, preset: 'slow' }] });
    const running = await waitJob(conv.id, (j) => j.status === 'running' && (j.current?.pct ?? 0) > 0);
    expect(running.current?.file).toBe('media/Phone/long.mp4');
    // A main-lane job finishes while the encode is still going.
    const other = await waitJob((await api<JobInfo>('POST', '/api/jobs', { selection: sel('Phone/low.mp4'), steps: [{ type: 'syncFileDates' }] })).id);
    expect(other.status).toBe('done');
    expect((await api<JobInfo>('GET', `/api/jobs/${conv.id}`)).status).toBe('running');

    await api('POST', `/api/jobs/${conv.id}/cancel`);
    const done = await waitJob(conv.id);
    expect(done.status).toBe('cancelled');
    expect(done.errors).toEqual([]);
    expect(fs.statSync(media('Phone', 'long.mp4')).size).toBe(size);
    expect(fs.readdirSync(media('Phone')).filter((n) => n.startsWith('.'))).toEqual([]);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM convert_tmp').get()).toEqual({ n: 0 });
  }, 120_000);
});
