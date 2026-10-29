import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ConfigSchema, type AppConfig } from './schema.js';

export interface LoadedConfig {
  config: AppConfig;
  appDir: string;
  configPath: string;
}

type Plain = Record<string, unknown>;

const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep merge where `over` wins on conflicting keys; arrays and scalars are replaced, not merged. */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (!isPlain(base) || !isPlain(over)) return over === undefined ? base : over;
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

function parseYaml(text: string, where: string): Plain {
  const doc = YAML.parse(text);
  if (doc == null) return {};
  if (!isPlain(doc)) throw new Error(`${where} must be a YAML mapping`);
  return doc;
}

/**
 * Read /app/config.yaml (if present), merge APP_CONFIG over it (env wins), validate,
 * and write the merged result back so the file always reflects what the app runs with.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const appDir = path.resolve(env.APP_DIR || '/app');
  const configPath = path.join(appDir, 'config.yaml');

  const fromFile = fs.existsSync(configPath) ? parseYaml(fs.readFileSync(configPath, 'utf8'), configPath) : null;
  const fromEnv = env.APP_CONFIG?.trim() ? parseYaml(env.APP_CONFIG, 'APP_CONFIG') : null;
  if (!fromFile && !fromEnv) {
    throw new Error(`No configuration: set APP_CONFIG or provide ${configPath}`);
  }

  const merged = deepMerge(fromFile ?? {}, fromEnv ?? {}) as Plain;
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }

  const config = result.data;
  if (env.PORT) config.server.port = Number(env.PORT);

  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(configPath, `# Managed by image-organizer: APP_CONFIG is merged over this file at startup.\n${YAML.stringify(merged)}`, {
    mode: 0o600,
  });
  return { config, appDir, configPath };
}
