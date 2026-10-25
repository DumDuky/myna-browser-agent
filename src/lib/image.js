/** Image normalization helpers (service-worker friendly). */

import { dataUrlParts } from './util.js';

export async function normalizeScreenshot(
  dataUrl,
  { maxWidth = 1280, maxHeight = 1600, quality = 0.92 } = {}
) {
  const parts = dataUrlParts(dataUrl);
  if (!parts) throw new Error('Invalid screenshot data.');
  const original = {
    dataUrl,
    base64: parts.base64,
    mediaType: parts.mediaType,
    width: 0,
    height: 0
  };
  const dimensions = imageDimensions(parts.base64, parts.mediaType);
  original.width = dimensions.width;
  original.height = dimensions.height;
  if (
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas !== 'function'
  ) {
    return original;
  }
  try {
    const blob = base64ToBlob(parts.base64, parts.mediaType);
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(
      1,
      maxWidth > 0 ? maxWidth / bitmap.width : 1,
      maxHeight > 0 ? maxHeight / bitmap.height : 1
    );
    if (scale >= 0.999) {
      bitmap.close?.();
      return {
        ...original,
        width: bitmap.width,
        height: bitmap.height
      };
    }
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return original;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const outBlob = await canvas.convertToBlob({
      type: parts.mediaType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      quality
    });
    const buffer = await outBlob.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    return {
      dataUrl: `data:${outBlob.type};base64,${base64}`,
      base64,
      mediaType: outBlob.type,
      width,
      height
    };
  } catch {
    return original;
  }
}

export function imageDimensions(base64, mediaType = 'image/png') {
  try {
    const binary = atob(base64.slice(0, 4096));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (mediaType === 'image/png' && bytes.length >= 24) {
      const view = new DataView(bytes.buffer);
      return {
        width: view.getUint32(16),
        height: view.getUint32(20)
      };
    }
    if (mediaType === 'image/jpeg') {
      let i = 2;
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = bytes[i + 1];
        const length = (bytes[i + 2] << 8) | bytes[i + 3];
        if (marker >= 0xc0 && marker <= 0xc3) {
          return {
            height: (bytes[i + 5] << 8) | bytes[i + 6],
            width: (bytes[i + 7] << 8) | bytes[i + 8]
          };
        }
        i += 2 + length;
      }
    }
  } catch {
    /* ignore */
  }
  return { width: 0, height: 0 };
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBlob(base64, mediaType = 'application/octet-stream') {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mediaType });
}
