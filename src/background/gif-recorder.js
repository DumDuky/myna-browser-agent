/** GIF recording and encoding for browser sessions. */

import { captureFrame } from './screenshots.js';
import { pageCall } from './tabs.js';
import { arrayBufferToBase64, base64ToBlob } from '../lib/image.js';
import { dataUrlParts } from '../lib/util.js';
import { GIFEncoder, quantize, applyPalette } from '../vendor/gifenc.js';

const recordings = new Map();
const MAX_FRAMES = 40;
const FRAME_WIDTH = 640;

export function isRecording(tabId) {
  return !!recordings.get(Number(tabId))?.active;
}

export function startRecording(tabId) {
  const id = Number(tabId);
  recordings.set(id, {
    active: true,
    startedAt: Date.now(),
    frames: []
  });
  return { frames: 0 };
}

export async function stopRecording(tabId) {
  const recording = recordings.get(Number(tabId));
  if (!recording) return { frames: 0, active: false };
  recording.active = false;
  return { frames: recording.frames.length, active: false };
}

export function clearRecording(tabId) {
  recordings.delete(Number(tabId));
  return { frames: 0 };
}

export function recordingState(tabId) {
  const recording = recordings.get(Number(tabId));
  if (!recording) return { active: false, frames: 0 };
  return { active: recording.active, frames: recording.frames.length };
}

export async function recordFrame(tabId) {
  const id = Number(tabId);
  const recording = recordings.get(id);
  if (!recording || !recording.active) return false;
  if (recording.frames.length >= MAX_FRAMES) return false;
  try {
    await pageCall(id, 'indicator', [{ show: false }]);
  } catch {
    /* ignore */
  }
  try {
    const frame = await captureFrame(id, {
      maxWidth: FRAME_WIDTH,
      scale: 1
    });
    const decoded = await decodeFrame(frame.dataUrl);
    if (!decoded) return false;
    recording.frames.push({
      data: decoded.data,
      width: decoded.width,
      height: decoded.height,
      createdAt: Date.now()
    });
    return true;
  } catch {
    return false;
  }
}

async function decodeFrame(dataUrl) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    return null;
  }
  const parts = dataUrlParts(dataUrl);
  if (!parts) return null;
  const blob = base64ToBlob(parts.base64, parts.mediaType);
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, FRAME_WIDTH / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close?.();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const imageData = ctx.getImageData(0, 0, width, height);
  return { data: imageData.data, width, height };
}

export async function exportGif(tabId) {
  const recording = recordings.get(Number(tabId));
  const frames = recording?.frames || [];
  if (!frames.length) {
    throw new Error('No GIF frames captured yet. Start recording first.');
  }
  const gif = GIFEncoder();
  for (const frame of frames) {
    const palette = quantize(frame.data, 256);
    const index = applyPalette(frame.data, palette);
    gif.writeFrame(index, frame.width, frame.height, {
      palette,
      delay: 450,
      repeat: 0
    });
  }
  gif.finish();
  const bytes = gif.bytes();
  const base64 = arrayBufferToBase64(bytes.slice().buffer);
  return {
    dataUrl: `data:image/gif;base64,${base64}`,
    base64,
    width: frames[0].width,
    height: frames[0].height,
    frames: frames.length
  };
}

export async function downloadGif(gif, filename = `myna-recording-${Date.now()}.gif`) {
  const id = await chrome.downloads.download({
    url: gif.dataUrl,
    filename,
    saveAs: true
  });
  return { downloadId: id, filename };
}
