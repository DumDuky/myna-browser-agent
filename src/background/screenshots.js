/** Screenshot capture and coordinate-frame bookkeeping. */

import { getTab, getViewport, focusTab } from './tabs.js';
import {
  captureScreenshot as cdpScreenshot,
  hasDebuggerPermission
} from './cdp.js';
import { normalizeScreenshot } from '../lib/image.js';
import { sleep } from '../lib/util.js';

const frames = new Map(); // tabId -> coordinate frame

export async function captureFrame(
  tabId,
  {
    scale = 1,
    maxWidth = 1280,
    region = null,
    format = 'png',
    preferVisibleTab = false
  } = {}
) {
  const id = Number(tabId);
  const tab = await getTab(id);
  const viewport = (await getViewport(id)) || {
    width: 1280,
    height: 800,
    dpr: 1
  };
  const canDebug = await hasDebuggerPermission();

  let shot = null;
  if (canDebug) {
    const x = region ? Math.max(0, region[0]) : 0;
    const y = region ? Math.max(0, region[1]) : 0;
    const width = region ? Math.max(1, region[2] - region[0]) : viewport.width;
    const height = region ? Math.max(1, region[3] - region[1]) : viewport.height;
    const targetScale = Math.max(
      0.1,
      Math.min(scale || 1, maxWidth > 0 ? maxWidth / width : 1)
    );
    try {
      shot = await cdpScreenshot(id, {
        x,
        y,
        width,
        height,
        scale: targetScale,
        format
      });
      shot.dataUrl = `data:image/${format};base64,${shot.base64}`;
    } catch {
      shot = null;
    }
  }

  if (!shot && !preferVisibleTab) {
    try {
      // captureVisibleTab only works for the active tab. Bring it forward; the
      // page is already the conversation tab, so this is usually a no-op.
      const current = await getTab(id);
      if (!current.active) await focusTab(id);
      let dataUrl;
      try {
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: format === 'jpeg' ? 'jpeg' : 'png',
          quality: format === 'jpeg' ? 85 : undefined
        });
      } catch {
        await sleep(700);
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: format === 'jpeg' ? 'jpeg' : 'png',
          quality: format === 'jpeg' ? 85 : undefined
        });
      }
      const normalized = await normalizeScreenshot(dataUrl, {
        maxWidth,
        maxHeight: Math.round(maxWidth * 1.5)
      });
      shot = {
        dataUrl: normalized.dataUrl,
        base64: normalized.base64,
        format: normalized.mediaType === 'image/jpeg' ? 'jpeg' : 'png',
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        cssX: 0,
        cssY: 0,
        cssWidth: viewport.width,
        cssHeight: viewport.height,
        width: normalized.width,
        height: normalized.height,
        scale: normalized.width / Math.max(1, viewport.width)
      };
    } catch {
      shot = null;
    }
  }

  if (!shot) {
    throw new Error(
      'Could not capture a screenshot. Grant the optional debugger permission in Settings, or make the tab active.'
    );
  }

  const frame = {
    dataUrl: shot.dataUrl,
    base64: shot.base64,
    format: shot.format || format,
    cssX: shot.cssX || 0,
    cssY: shot.cssY || 0,
    cssWidth: shot.cssWidth || viewport.width,
    cssHeight: shot.cssHeight || viewport.height,
    imageWidth: shot.width || viewport.width,
    imageHeight: shot.height || viewport.height,
    scaleX:
      (shot.cssWidth || viewport.width) /
      Math.max(1, shot.width || viewport.width),
    scaleY:
      (shot.cssHeight || viewport.height) /
      Math.max(1, shot.height || viewport.height),
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    capturedAt: Date.now()
  };
  frames.set(id, frame);
  return frame;
}

export function getFrame(tabId) {
  return frames.get(Number(tabId)) || null;
}

export function clearFrame(tabId) {
  frames.delete(Number(tabId));
}

export function mapCoordinate(tabId, coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
  const x = Number(coordinate[0]);
  const y = Number(coordinate[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const frame = getFrame(tabId);
  if (!frame) return { x, y, mapped: false };
  return {
    x: frame.cssX + x * frame.scaleX,
    y: frame.cssY + y * frame.scaleY,
    mapped: true,
    frame
  };
}

export function frameSummary(frame) {
  if (!frame) return '';
  const parts = [
    `${frame.imageWidth}×${frame.imageHeight} image`,
    `${Math.round(frame.cssWidth)}×${Math.round(frame.cssHeight)} page region`
  ];
  if (frame.scaleX !== 1 || frame.scaleY !== 1) {
    parts.push(
      `coordinates are image pixels; Myna maps them to the page automatically`
    );
  }
  return parts.join(', ');
}
