import { SettingsSchema, type Settings } from '@io/shared';
import type { DB } from '../db/db.js';

const KEY = 'app';

/** Dynamic settings (Settings page), stored as one JSON row and cached in memory. */
export class SettingsStore {
  private cache: Settings | null = null;
  private listeners = new Set<(s: Settings) => void>();

  constructor(private db: DB) {}

  get(): Settings {
    if (this.cache) return this.cache;
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
    const parsed = SettingsSchema.safeParse(row ? JSON.parse(row.value) : {});
    this.cache = parsed.success ? parsed.data : SettingsSchema.parse({});
    return this.cache;
  }

  set(input: unknown): Settings {
    const next = SettingsSchema.parse(input);
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(KEY, JSON.stringify(next));
    this.cache = next;
    for (const l of this.listeners) l(next);
    return next;
  }

  onChange(fn: (s: Settings) => void): void {
    this.listeners.add(fn);
  }
}
