import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as ort from 'onnxruntime-web';
import sharp from 'sharp';
import type { AppConfig } from '../config/schema.js';

const SIZE = 224;
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];

/**
 * CLIP ViT-B/32 image encoder for "similar scene" grouping. Runs on onnxruntime-web's WASM backend:
 * the image is Alpine (musl), where onnxruntime-node has no binaries. The model (~90 MB) is downloaded
 * on first use into /app/cache/models unless `similar.modelPath` points at a local copy.
 */
export class ClipModel {
  private session: Promise<ort.InferenceSession> | null = null;
  /** Runs are serialized: one WASM session, already multi-threaded. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private config: AppConfig['similar'],
    private appDir: string,
  ) {}

  get enabled() {
    return this.config.enabled;
  }

  /** Load (downloading if needed) before a scan starts hashing, so progress can show the step. */
  load(): Promise<ort.InferenceSession> {
    if (!this.session) {
      this.session = this.open().catch((e) => {
        this.session = null;
        throw e;
      });
    }
    return this.session;
  }

  /** L2-normalized 512-d embedding of an image (a cached thumbnail is plenty). */
  embed(image: string): Promise<Float32Array> {
    const run = this.queue.then(async () => {
      const session = await this.load();
      const { data } = await sharp(image).resize(SIZE, SIZE, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const n = SIZE * SIZE;
      const px = new Float32Array(3 * n);
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) px[c * n + i] = (data[i * 3 + c] / 255 - MEAN[c]) / STD[c];
      const out = await session.run({ pixel_values: new ort.Tensor('float32', px, [1, 3, SIZE, SIZE]) });
      const v = out.image_embeds.data as Float32Array;
      let norm = 0;
      for (const x of v) norm += x * x;
      norm = Math.sqrt(norm) || 1;
      return Float32Array.from(v, (x) => x / norm);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async open(): Promise<ort.InferenceSession> {
    if (!this.config.enabled) throw new Error('Similar-scene search is disabled (similar.enabled: false).');
    ort.env.wasm.numThreads = Math.max(1, Math.min(4, os.availableParallelism() - 1));
    const file = this.config.modelPath ?? (await this.download());
    return ort.InferenceSession.create(await fs.readFile(file), { executionProviders: ['wasm'] });
  }

  private async download(): Promise<string> {
    const dir = path.join(this.appDir, 'cache', 'models');
    const file = path.join(dir, 'clip-vit-b32-vision-quantized.onnx');
    try {
      await fs.access(file);
      return file;
    } catch {
      /* not downloaded yet */
    }
    await fs.mkdir(dir, { recursive: true });
    const res = await fetch(this.config.modelUrl);
    if (!res.ok) throw new Error(`Couldn't download the similarity model (${res.status} ${res.statusText}) from ${this.config.modelUrl}`);
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
      await fs.rename(tmp, file);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
    return file;
  }
}
