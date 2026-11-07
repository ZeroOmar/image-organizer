import type { AppConfig } from './config/schema.js';
import type { DB } from './db/db.js';
import type { Ownership } from './fs/ownership.js';
import type { Roots } from './fs/roots.js';
import type { Indexer } from './index/indexer.js';
import type { JobEngine } from './jobs/engine.js';
import type { Metadata } from './metadata/exiftool.js';
import type { SettingsStore } from './settings/store.js';
import type { Thumbs } from './thumbs/thumbs.js';
import type { Trash } from './trash/trash.js';
import type { Automation } from './automation/automation.js';
import type { DupeScanner } from './dupes/scanner.js';

/** Everything route modules need. Built once in main.ts. */
export interface AppContext {
  config: AppConfig;
  appDir: string;
  db: DB;
  roots: Roots;
  settings: SettingsStore;
  /** Settings → Ownership, applied to everything the app writes. */
  ownership: Ownership;
  metadata: Metadata;
  indexer: Indexer;
  thumbs: Thumbs;
  trash: Trash;
  jobs: JobEngine;
  automation: Automation;
  dupes: DupeScanner;
}
