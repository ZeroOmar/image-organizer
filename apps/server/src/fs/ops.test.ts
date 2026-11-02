import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFileTimes } from './ops.js';

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
