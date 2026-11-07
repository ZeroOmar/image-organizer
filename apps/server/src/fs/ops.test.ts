import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { moveFile, setFileTimes } from './ops.js';

const eperm = () => Object.assign(new Error("EPERM: operation not permitted, utime 'x'"), { code: 'EPERM' });

describe('setFileTimes', () => {
  afterEach(() => vi.restoreAllMocks());
  const when = new Date('2026-09-25T15:20:05Z');

  it('sets times directly when the app owns the file', async () => {
    const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'io-ops-'));
    const f = path.join(dir, 'a.jpg');
    fsSync.writeFileSync(f, 'jpeg');
    expect(await setFileTimes(f, when, when)).toBe(false);
    expect(fsSync.statSync(f).mtime.toISOString()).toBe(when.toISOString());
  });

  it("replaces a file owned by another user (EPERM) with an identical copy, keeping its mode", async () => {
    const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'io-ops-'));
    const f = path.join(dir, '20260925_182005_PIC.jpg');
    fsSync.writeFileSync(f, 'jpeg bytes');
    fsSync.chmodSync(f, 0o640);
    const ino = fsSync.statSync(f).ino;
    // The kernel refuses explicit times on a file we don't own; only the first call (on the original) fails.
    vi.spyOn(fs, 'utimes').mockRejectedValueOnce(eperm());
    expect(await setFileTimes(f, when, when)).toBe(true);
    const st = fsSync.statSync(f);
    expect(st.ino).not.toBe(ino);
    expect(st.mtime.toISOString()).toBe(when.toISOString());
    expect(st.mode & 0o777).toBe(0o640);
    expect(fsSync.readFileSync(f, 'utf8')).toBe('jpeg bytes');
    expect(fsSync.readdirSync(dir)).toEqual(['20260925_182005_PIC.jpg']);
  });

  it('explains the PUID mismatch when the folder is not writable either', async () => {
    const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'io-ops-'));
    const f = path.join(dir, 'b.jpg');
    fsSync.writeFileSync(f, 'jpeg');
    vi.spyOn(fs, 'utimes').mockRejectedValueOnce(eperm());
    vi.spyOn(fs, 'copyFile').mockRejectedValueOnce(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));
    await expect(setFileTimes(f, when, when)).rejects.toThrow(/belongs to user \d+.*Set PUID\/PGID to the owner of the share/);
    expect(fsSync.readdirSync(dir)).toEqual(['b.jpg']);
  });

  it('rethrows other errors', async () => {
    await expect(setFileTimes('/nonexistent/x.jpg', when, when)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('moveFile across devices', () => {
  afterEach(() => vi.restoreAllMocks());

  it('moves a whole folder (copy, verify, remove) when rename() fails with EXDEV', async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'io-ops-'));
    const src = path.join(tmp, 'a', 'Album');
    fsSync.mkdirSync(path.join(src, 'Sub'), { recursive: true });
    fsSync.writeFileSync(path.join(src, 'x.jpg'), 'xx');
    fsSync.writeFileSync(path.join(src, 'Sub', 'y.mp4'), 'yyy');
    const mtime = new Date('2026-10-08T06:41:00Z');
    fsSync.utimesSync(path.join(src, 'x.jpg'), mtime, mtime);

    // Only the first rename (the direct one) crosses devices; the temp-folder rename next to dst is local.
    const real = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementationOnce(async () => {
      throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
    });
    vi.mocked(fs.rename).mockImplementation(real);

    const dst = path.join(tmp, 'b', 'Album');
    await moveFile(src, dst);
    expect(fsSync.existsSync(src)).toBe(false);
    expect(fsSync.readdirSync(dst, { recursive: true }).map(String).sort()).toEqual(['Sub', 'Sub/y.mp4', 'x.jpg']);
    expect(fsSync.statSync(path.join(dst, 'x.jpg')).mtime).toEqual(mtime);
    expect(fsSync.readdirSync(path.join(tmp, 'b'))).toEqual(['Album']);
    fsSync.rmSync(tmp, { recursive: true, force: true });
  });
});
