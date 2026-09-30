/** Image helpers for sketch import (browser only). */

export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const out = { width: bmp.width, height: bmp.height };
  bmp.close();
  return out;
}

/**
 * Downscales (for upload to a vision model) and re-encodes as JPEG. Also
 * normalizes phone photos: createImageBitmap applies EXIF orientation.
 */
export async function toJpegBase64(blob: Blob, maxSide = 1600): Promise<{ data: string; width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s);
  const h = Math.round(bmp.height * s);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const url = c.toDataURL('image/jpeg', 0.88);
  return { data: url.slice(url.indexOf(',') + 1), width: w, height: h };
}

export const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif';
