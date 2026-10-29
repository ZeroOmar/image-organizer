import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * App version: APP_VERSION (set by the Docker build from the git tag) or the root package.json
 * version. Works from src/ (tsx) and dist/ (node) — both sit three levels below the repo root.
 */
function readVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION.replace(/^v/, '');
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../../../package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const APP_VERSION = readVersion();
