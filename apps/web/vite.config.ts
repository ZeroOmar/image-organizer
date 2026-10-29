import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Single source of the logo: apps/app-icon.svg (moved there from the repo root). */
const ICON = path.resolve(here, '../app-icon.svg');

const manifest = JSON.stringify({
  name: 'Image Organizer',
  short_name: 'Organizer',
  start_url: '/',
  display: 'standalone',
  background_color: '#000000',
  theme_color: '#000000',
  icons: [
    { src: '/app-icon.svg', sizes: 'any', type: 'image/svg+xml' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
});

/** Serves (dev) and emits (build) the favicon, PNG icons and web manifest from apps/app-icon.svg. */
function brandIcons(): Plugin {
  const png = (size: number) => sharp(fs.readFileSync(ICON), { density: 384 }).resize(size, size).png().toBuffer();
  const assets: Record<string, () => Promise<Buffer | string>> = {
    '/app-icon.svg': async () => fs.readFileSync(ICON),
    '/apple-touch-icon.png': () => png(180),
    '/icon-512.png': () => png(512),
    '/manifest.webmanifest': async () => manifest,
  };
  const types: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', webmanifest: 'application/manifest+json' };
  return {
    name: 'brand-icons',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const make = assets[req.url ?? ''];
        if (!make) return next();
        res.setHeader('Content-Type', types[req.url!.split('.').pop()!]);
        res.end(await make());
      });
    },
    async generateBundle() {
      for (const [url, make] of Object.entries(assets)) this.emitFile({ type: 'asset', fileName: url.slice(1), source: await make() });
    },
  };
}

export default defineConfig({
  plugins: [react(), brandIcons()],
  resolve: { alias: { '@brand': path.resolve(here, '..') } },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(here, '../..')] },
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT ?? 8080}`, changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
