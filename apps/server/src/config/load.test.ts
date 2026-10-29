import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deepMerge, loadConfig } from './load.js';

const HASH = '$2b$12$' + 'a'.repeat(53);
const base = `admin: { username: admin, passwordHash: "${HASH}" }\nsession: { secret: "0123456789abcdef" }\n`;

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'io-config-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('deepMerge', () => {
  it('lets the override win and keeps base-only keys', () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, d: [1] }, { a: { b: 9 }, d: [2] })).toEqual({ a: { b: 9, c: 2 }, d: [2] });
  });
});

describe('loadConfig', () => {
  it('uses env only when there is no file, and writes the file', () => {
    const { config, configPath } = loadConfig({ APP_DIR: dir, APP_CONFIG: base });
    expect(config.admin.username).toBe('admin');
    expect(config.media.root).toBe('/media');
    expect(config.trash.retentionDays).toBe(30);
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it('merges env over the file: env wins, file-only keys are kept', () => {
    fs.writeFileSync(path.join(dir, 'config.yaml'), base + 'timezone: { default: Asia/Tokyo }\nmedia: { root: /from-file }\n');
    const { config, configPath } = loadConfig({ APP_DIR: dir, APP_CONFIG: 'media: { root: /from-env }\n' });
    expect(config.media.root).toBe('/from-env');
    expect(config.timezone.default).toBe('Asia/Tokyo');
    expect(YAML.parse(fs.readFileSync(configPath, 'utf8')).media.root).toBe('/from-env');
  });

  it('fails with a readable error', () => {
    expect(() => loadConfig({ APP_DIR: dir, APP_CONFIG: 'admin: { username: x, passwordHash: plain }' })).toThrow(/passwordHash/);
    expect(() => loadConfig({ APP_DIR: dir })).toThrow(/No configuration/);
  });
});
