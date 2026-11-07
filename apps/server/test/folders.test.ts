/**
 * Folder operations from the Folders pane menu: rename, move (also across roots), copy, trash,
 * permanent delete, chmod and chown. Each runs as a job; all but delete undo.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';
import type { FolderJobRequest, JobInfo, PlanResult } from '@io/shared';
import { createContext } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/load.js';
import type { AppContext } from '../src/context.js';
import { buildApp } from '../src/http/app.js';

let tmp: string;
let ctx: AppContext;
let app: FastifyInstance;
let cookie = '';

async function api<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
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

const plan = (req: FolderJobRequest) => api<PlanResult>('POST', '/api/folders/plan', req);
const run = async (req: FolderJobRequest) => waitJob((await api<JobInfo>('POST', '/api/folders/apply', req)).id);
const undo = async (job: JobInfo) => waitJob((await api<JobInfo>('POST', `/api/jobs/${job.id}/undo`)).id);
const media = (...p: string[]) => path.join(tmp, 'media', ...p);
const ls = (dir: string) => fs.readdirSync(dir, { recursive: true }).map(String).sort();
const mode = (p: string) => fs.statSync(p).mode & 0o777;
const MTIME = new Date('2026-10-08T06:41:00Z');

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'io-folders-'));
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

beforeEach(() => {
  for (const r of ['media', 'import']) fs.rmSync(path.join(tmp, r), { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'import'));
  fs.mkdirSync(media('Trips', 'Bikers', 'Day 2'), { recursive: true });
  fs.mkdirSync(media('Archive'));
  fs.writeFileSync(media('Trips', 'Bikers', 'a.jpg'), 'aaaa');
  fs.writeFileSync(media('Trips', 'Bikers', 'Day 2', 'b.mp4'), 'bbbbbbbb');
  fs.writeFileSync(media('Trips', 'Bikers', '.hidden'), 'h');
  fs.utimesSync(media('Trips', 'Bikers', 'a.jpg'), MTIME, MTIME);
});

afterAll(async () => {
  await app?.close();
  await ctx?.metadata.close();
  ctx?.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const bikers = { root: 'media' as const, rel: 'Trips/Bikers' };
const CONTENT = ['.hidden', 'Day 2', 'Day 2/b.mp4', 'a.jpg'];

describe('folder operations', () => {
  it('rename: dry run, then job; undo renames back', async () => {
    const p = await plan({ folder: bikers, op: { type: 'rename', name: 'Bikers 2026' } });
    expect(p.items).toEqual([expect.objectContaining({ before: 'Bikers', after: 'Bikers 2026' })]);
    expect(p.warnings[0]).toBe('Contains 3 files in 2 folders, 1 KB.');
    const job = await run({ folder: bikers, op: { type: 'rename', name: 'Bikers 2026' } });
    expect(job.status).toBe('done');
    expect(ls(media('Trips'))).toEqual(['Bikers 2026', ...CONTENT.map((c) => `Bikers 2026/${c}`)]);
    await undo(job);
    expect(ls(media('Trips', 'Bikers'))).toEqual(CONTENT);
    await expect(plan({ folder: bikers, op: { type: 'rename', name: '../x' } })).rejects.toThrow(/400/);
  });

  it("move: into another folder and across roots; never into itself or over an existing folder", async () => {
    expect((await plan({ folder: bikers, op: { type: 'move', dest: { root: 'media', rel: 'Trips/Bikers/Day 2' } } })).items[0].error).toMatch(/into itself/);
    fs.mkdirSync(media('Archive', 'Bikers'));
    expect((await plan({ folder: bikers, op: { type: 'move', dest: { root: 'media', rel: 'Archive' } } })).items[0].error).toMatch(/already exists/);
    fs.rmdirSync(media('Archive', 'Bikers'));

    const job = await run({ folder: bikers, op: { type: 'move', dest: { root: 'import', rel: '' } } });
    expect(job.status).toBe('done');
    expect(fs.existsSync(media('Trips', 'Bikers'))).toBe(false);
    expect(ls(path.join(tmp, 'import', 'Bikers'))).toEqual(CONTENT);
    await undo(job);
    expect(ls(media('Trips', 'Bikers'))).toEqual(CONTENT);
  });

  it('copy: keeps contents and dates, picks a free name, undo trashes the copy', async () => {
    const job = await run({ folder: bikers, op: { type: 'copy', dest: { root: 'media', rel: 'Trips' } } });
    expect(job.status).toBe('done');
    expect(ls(media('Trips', 'Bikers_1'))).toEqual(CONTENT);
    expect(fs.statSync(media('Trips', 'Bikers_1', 'a.jpg')).mtime).toEqual(MTIME);
    expect(fs.readdirSync(media('Trips')).filter((n) => n.startsWith('.io-tmp'))).toEqual([]);
    await undo(job);
    expect(fs.existsSync(media('Trips', 'Bikers_1'))).toBe(false);
    expect(ctx.trash.list()[0]).toMatchObject({ originalRel: 'Trips/Bikers_1', size: 13 });
  });

  it('trash: one restorable trash item for the whole folder', async () => {
    const job = await run({ folder: bikers, op: { type: 'trash' } });
    expect(job.status).toBe('done');
    expect(fs.existsSync(media('Trips', 'Bikers'))).toBe(false);
    const item = ctx.trash.list().find((t) => t.originalRel === 'Trips/Bikers')!;
    expect(item.size).toBe(13);
    await undo(job);
    expect(ls(media('Trips', 'Bikers'))).toEqual(CONTENT);
    // Purging a folder item removes the folder.
    const again = await run({ folder: bikers, op: { type: 'trash' } });
    const id = ctx.trash.list().find((t) => t.originalRel === 'Trips/Bikers')!.id;
    await api('POST', '/api/trash/purge', { ids: [id] });
    expect(fs.existsSync(path.join(tmp, 'trash', 'media', 'Trips', 'Bikers'))).toBe(false);
    expect(again.status).toBe('done');
  });

  it("delete: removes the folder for good and can't be undone", async () => {
    expect((await plan({ folder: bikers, op: { type: 'delete' } })).warnings).toContain("This can't be undone: the folder skips the trash.");
    const job = await run({ folder: bikers, op: { type: 'delete' } });
    expect(job).toMatchObject({ status: 'done', undoable: false });
    expect(fs.existsSync(media('Trips', 'Bikers'))).toBe(false);
  });

  it('refuses to rename, move or delete a root, and anything in the trash', async () => {
    await expect(plan({ folder: { root: 'media', rel: '' }, op: { type: 'trash' } })).rejects.toThrow(/400/);
    await expect(plan({ folder: { root: 'trash', rel: '' }, op: { type: 'chmod', dirMode: '755' } })).rejects.toThrow(/400/);
  });

  it('chmod: separate folder and file modes, recursive; undo restores them', async () => {
    fs.chmodSync(media('Trips', 'Bikers', 'a.jpg'), 0o644);
    const job = await run({ folder: bikers, op: { type: 'chmod', dirMode: '750', fileMode: '640', recursive: true } });
    expect(job.status).toBe('done');
    expect(mode(media('Trips', 'Bikers'))).toBe(0o750);
    expect(mode(media('Trips', 'Bikers', 'Day 2'))).toBe(0o750);
    expect(mode(media('Trips', 'Bikers', 'a.jpg'))).toBe(0o640);
    expect(mode(media('Trips', 'Bikers', 'Day 2', 'b.mp4'))).toBe(0o640);
    await undo(job);
    expect(mode(media('Trips', 'Bikers', 'a.jpg'))).toBe(0o644);
    expect(mode(media('Trips', 'Bikers'))).not.toBe(0o750);
    // Unchanged entries aren't planned.
    expect((await plan({ folder: bikers, op: { type: 'chmod', fileMode: '644', recursive: false } })).items).toEqual([]);
  });

  it('chown: changes the group to one of our own; refuses other owners without root', async () => {
    const uid = process.getuid!();
    const other = process.getgroups!().find((g) => g !== fs.statSync(media('Trips', 'Bikers')).gid);
    if (other !== undefined) {
      const job = await run({ folder: bikers, op: { type: 'chown', gid: other, recursive: true } });
      expect(job.status).toBe('done');
      expect(fs.statSync(media('Trips', 'Bikers', 'Day 2', 'b.mp4')).gid).toBe(other);
      const before = (await undo(job)).status;
      expect(before).toBe('done');
      expect(fs.statSync(media('Trips', 'Bikers', 'Day 2', 'b.mp4')).gid).not.toBe(other);
    }
    if (uid !== 0) {
      const p = await plan({ folder: bikers, op: { type: 'chown', uid: uid + 1, recursive: false } });
      expect(p.items[0].error).toMatch(/Only root can give files to another user/);
      expect(p.warnings[0]).toMatch(/can't be changed by the app's user/);
    }
  });
});
