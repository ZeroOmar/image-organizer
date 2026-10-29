import { Automation } from './automation/automation.js';
import type { AppConfig } from './config/schema.js';
import type { AppContext } from './context.js';
import { openDb } from './db/db.js';
import { Roots } from './fs/roots.js';
import { Indexer } from './index/indexer.js';
import { JobEngine } from './jobs/engine.js';
import { Metadata } from './metadata/exiftool.js';
import { SettingsStore } from './settings/store.js';
import { Thumbs } from './thumbs/thumbs.js';
import { Trash } from './trash/trash.js';

/** Wire all services together. Shared by main.ts and the integration tests. */
export function createContext(config: AppConfig, appDir: string): AppContext & { devices: Record<string, number> } {
  const db = openDb(appDir);
  const roots = new Roots(config);
  const devices = roots.init();
  const settings = new SettingsStore(db);
  const metadata = new Metadata();
  const indexer = new Indexer(db, roots, metadata, settings, config.timezone.default);
  const thumbs = new Thumbs(appDir, roots, metadata);
  const trash = new Trash(db, roots);
  const jobs = new JobEngine(db, roots, indexer, metadata, trash, settings, config.timezone.default);
  const automation = new Automation(db, roots, jobs);
  return { config, appDir, db, roots, settings, metadata, indexer, thumbs, trash, jobs, automation, devices };
}
