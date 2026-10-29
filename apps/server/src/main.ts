import { Cron } from 'croner';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext } from './bootstrap.js';
import { loadConfig } from './config/load.js';
import { buildApp } from './http/app.js';
import { APP_VERSION } from './version.js';

async function main() {
  const { config, appDir, configPath } = loadConfig();
  const ctx = createContext(config, appDir);
  const { roots, devices } = ctx;

  console.log(`image-organizer ${APP_VERSION}`);
  console.log(`config: ${configPath}`);
  for (const [name, dir] of Object.entries(roots.dirs)) console.log(`root ${name}: ${dir}`);
  if (devices.trash !== devices.media || devices.trash !== devices.import) {
    console.log('trash is on a different device: trash/restore use copy + verify + unlink');
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = process.env.WEB_DIST ?? path.resolve(here, '../../web/dist');
  const app = await buildApp(ctx, { webDist });

  const purge = async () => {
    const days = ctx.settings.get().trash.retentionDays ?? config.trash.retentionDays;
    if (days > 0) {
      const n = await ctx.jobs.exclusive(() => ctx.trash.purgeOlderThan(days));
      if (n) app.log.info(`purged ${n} trash item(s) older than ${days} days`);
    }
  };
  await purge();
  const purgeCron = new Cron('0 3 * * *', () => void purge());

  ctx.automation.start();

  let stopping = false;
  const shutdown = async () => {
    // Second Ctrl+C: exit immediately.
    if (stopping) process.exit(1);
    stopping = true;
    console.log('shutting down…');
    // Never hang on shutdown (e.g. an ExifTool process that won't end).
    setTimeout(() => process.exit(0), 5000).unref();
    purgeCron.stop();
    await ctx.automation.stop();
    await app.close();
    await ctx.metadata.close().catch(() => undefined);
    ctx.db.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.server.port, host: config.server.host });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
