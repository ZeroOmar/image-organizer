import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';

const run = promisify(execFile);

/**
 * Decode an image with ffmpeg (sharp's libheif has no HEVC decoder) to an 8-bit PNG buffer. ffmpeg
 * assembles tiled HEIF grids (every phone HEIC) at full resolution and applies the HEIF rotation
 * (irot/imir), so the pixels come out upright: don't rotate again or copy an EXIF Orientation over.
 * No scaling here: ffmpeg rejects -vf on the filtergraph it builds for a grid.
 */
export async function decodeImage(src: string): Promise<Buffer> {
  const { stdout } = await run(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-v', 'error', '-i', src, '-frames:v', '1', '-pix_fmt', 'rgb24', '-c:v', 'png', '-compression_level', '0', '-f', 'image2pipe', '-'],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024, timeout: 120_000 },
  ).catch((e: Error & { stderr?: Buffer }) => {
    throw new Error(`ffmpeg could not decode the image: ${e.stderr?.toString().trim().split('\n').pop() || e.message}`);
  });
  if (!stdout.length) throw new Error('ffmpeg produced no image');
  return stdout;
}

/** HEIC/HEIF → JPEG. Pixel values are kept as-is (no color conversion); the caller copies the ICC profile. */
export async function heifToJpeg(src: string, out: string, quality: number): Promise<void> {
  await sharp(await decodeImage(src), { limitInputPixels: false }).keepIccProfile().jpeg({ quality }).toFile(out);
}
