/**
 * Settings → Ownership: files and folders the app creates or changes get the configured owner and
 * mode; existing parents and untouched files keep theirs. Owner changes need root, so these tests
 * check modes, and that a failed chown becomes one job note instead of failing the job.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, type FolderJobRequest, type JobInfo, type Settings } from '@io/shared';
import { createContext } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/load.js';
import type { AppContext } from '../src/context.js';
import { buildApp } from '../src/http/app.js';

let tmp: string;
let ctx: AppContext;
let app: FastifyInstance;
let cookie = '';

async function api<T>(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown): Promise<T> {
  const res = await app.inject({ method, url, payload: body as object, headers: { cookie, 'x-requested-with': 'image-organizer' } });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

async function waitJob(id: string): Promise<JobInfo> {
  for (;;) {
    const j = await api<JobInfo>('GET', `/api/jobs/${id}`);
    if (j.status !== 'queued' && j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 20));
  }
}

const run = async (req: FolderJobRequest) => waitJob((await api<JobInfo>('POST', '/api/folders/apply', req)).id);
const undo = async (job: JobInfo) => waitJob((await api<JobInfo>('POST', `/api/jobs/${job.id}/undo`)).id);
const setOwnership = (o: Partial<Settings['ownership']>) =>
  api<Settings>('PUT', '/api/settings', { ...defaultSettings(), ownership: { ...defaultSettings().ownership, enabled: true, ...o } });
const media = (...p: string[]) => path.join(tmp, 'media', ...p);
const mode = (p: string) => fs.statSync(p).mode & 0o777;
const isRoot = process.getuid?.() === 0;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'io-ownership-'));
  fs.mkdirSync(path.join(tmp, 'import'));
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
});

beforeEach(async () => {
  await api('PUT', '/api/settings', defaultSettings());
  fs.rmSync(media(), { recursive: true, force: true });
  fs.mkdirSync(media('Trips', 'Day 2'), { recursive: true, mode: 0o755 });
  fs.mkdirSync(media('Archive'), { mode: 0o755 });
  fs.writeFileSync(media('Trips', 'a.jpg'), 'aaaa', { mode: 0o644 });
  fs.writeFileSync(media('Trips', 'Day 2', 'b.mp4'), 'bbbb', { mode: 0o644 });
  fs.writeFileSync(media('Archive', 'keep.jpg'), 'kk', { mode: 0o644 });
});

afterAll(async () => {
  await app?.close();
  await ctx?.metadata.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('Settings → Ownership', () => {
  it('is off by default: a copy keeps the source modes', async () => {
    const job = await run({ folder: { root: 'media', rel: 'Trips' }, op: { type: 'copy', dest: { root: 'media', rel: 'Archive' } } });
    expect(job.status).toBe('done');
    expect(mode(media('Archive', 'Trips', 'a.jpg'))).toBe(0o644);
  });

  it('applies file and folder modes to everything a copy creates, and leaves the destination parent alone', async () => {
    await setOwnership({ fileMode: '660', dirMode: '770' });
    const job = await run({ folder: { root: 'media', rel: 'Trips' }, op: { type: 'copy', dest: { root: 'media', rel: 'Archive' } } });
    expect(job.status).toBe('done');
    expect(job.notes).toEqual([]);
    expect(mode(media('Archive', 'Trips'))).toBe(0o770);
    expect(mode(media('Archive', 'Trips', 'Day 2'))).toBe(0o770);
    expect(mode(media('Archive', 'Trips', 'a.jpg'))).toBe(0o660);
    expect(mode(media('Archive', 'Trips', 'Day 2', 'b.mp4'))).toBe(0o660);
    // Existing folders and files it didn't write keep their modes.
    expect(mode(media('Archive'))).toBe(0o755);
    expect(mode(media('Archive', 'keep.jpg'))).toBe(0o644);
    expect(mode(media('Trips', 'a.jpg'))).toBe(0o644);
  });

  it('applies to moves, trash folders it creates, and undo results', async () => {
    await setOwnership({ fileMode: '640', dirMode: '750' });
    const moved = await run({ folder: { root: 'media', rel: 'Trips' }, op: { type: 'move', dest: { root: 'import', rel: '' } } });
    expect(moved.status).toBe('done');
    expect(mode(path.join(tmp, 'import', 'Trips', 'a.jpg'))).toBe(0o640);

    await setOwnership({ fileMode: '600', dirMode: '700' });
    const back = await undo(moved);
    expect(back.status).toBe('done');
    expect(mode(media('Trips', 'a.jpg'))).toBe(0o600);

    const trashed = await run({ folder: { root: 'media', rel: 'Archive' }, op: { type: 'trash' } });
    expect(trashed.status).toBe('done');
    expect(mode(path.join(tmp, 'trash', 'media'))).toBe(0o700);
    expect(mode(path.join(tmp, 'trash', 'media', 'Archive', 'keep.jpg'))).toBe(0o600);
  });

  it('applies to new folders made from the Folders pane', async () => {
    await setOwnership({ dirMode: '775' });
    await api('POST', '/api/folders', { root: 'media', rel: 'Archive', name: 'New' });
    expect(mode(media('Archive', 'New'))).toBe(0o775);
  });

  it.skipIf(isRoot)('without root, a chown it may not make becomes one note and the job still succeeds', async () => {
    await setOwnership({ uid: 0, fileMode: '660' });
    const job = await run({ folder: { root: 'media', rel: 'Trips' }, op: { type: 'copy', dest: { root: 'media', rel: 'Archive' } } });
    expect(job.status).toBe('done');
    expect(job.errors).toEqual([]);
    expect(job.notes).toHaveLength(1);
    expect(job.notes[0].message).toMatch(/Ownership couldn't be applied to 4 item\(s\)/);
    // The mode still applies to files the app owns.
    expect(mode(media('Archive', 'Trips', 'a.jpg'))).toBe(0o660);
  });
});
