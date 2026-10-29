import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

/** Append-only. Each entry runs once, in order; the index is stored in user_version. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE media_cache (
    root TEXT NOT NULL,
    rel TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime_ms REAL NOT NULL,
    meta TEXT NOT NULL,
    error TEXT,
    PRIMARY KEY (root, rel)
  );
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    request TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    errors TEXT NOT NULL DEFAULT '[]',
    undo TEXT,
    rule_id TEXT,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX jobs_created ON jobs(created_at DESC);
  CREATE TABLE trash_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin_root TEXT NOT NULL,
    original_rel TEXT NOT NULL,
    trash_rel TEXT NOT NULL UNIQUE,
    size INTEGER NOT NULL,
    deleted_at INTEGER NOT NULL
  );
  CREATE TABLE rules (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    last_run_at INTEGER,
    last_job_id TEXT
  );
  `,
];

export function openDb(appDir: string): DB {
  const dir = path.join(appDir, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
