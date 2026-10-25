/**
 * Optional Chrome DevTools Protocol bridge.
 *
 * The debugger permission is optional. When granted, Myna uses trusted input
 * events, full-resolution screenshots, console logs, and network metadata.
 * Without it, Myna falls back to DOM events and captureVisibleTab.
 */

import { sleep } from '../lib/util.js';

const attached = new Map(); // tabId -> { attachedAt, enabled }
const attachPromises = new Map();
const consoleBuffers = new Map();
const networkBuffers = new Map();
const networkRequests = new Map(); // tabId -> Map(requestId -> record)
const lastHost = new Map();
const MAX_BUFFER = 500;

let listenersInstalled = false;

export async function hasDebuggerPermission() {
  try {
    return await chrome.permissions.contains({ permissions: ['debugger'] });
  } catch {
    return false;
  }
}

export function isAttached(tabId) {
  return attached.has(Number(tabId));
}

export async function attach(tabId) {
  const id = Number(tabId);
  if (attached.has(id)) return attached.get(id);
  if (attachPromises.has(id)) return attachPromises.get(id);
  if (!(await hasDebuggerPermission())) {
    throw new Error(
      'Enhanced browser access is off. Enable "Trusted browser control" in Myna settings to use the debugger.'
    );
  }
  const promise = (async () => {
    try {
      await chrome.debugger.attach({ tabId: id }, '1.3');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already attached/i.test(message)) {
        // Another debugger (often DevTools) owns the tab. We can still try to
        // send commands, but we cannot enable domains safely.
        const info = { attachedAt: Date.now(), enabled: false, foreign: true };
        attached.set(id, info);
        return info;
      }
      throw new Error(
        `Could not attach browser control: ${message}. Close DevTools for this tab and try again.`
      );
    }
    installListeners();
    const info = { attachedAt: Date.now(), enabled: true, foreign: false };
    attached.set(id, info);
    await Promise.allSettled([
      sendRaw(id, 'Page.enable'),
      sendRaw(id, 'Runtime.enable'),
      sendRaw(id, 'Log.enable'),
      sendRaw(id, 'Network.enable', {
        maxTotalBufferSize: 20 * 1024 * 1024,
        maxResourceBufferSize: 5 * 1024 * 1024,
        maxPostDataSize: 0
      })
    ]);
    return info;
  })();
  attachPromises.set(id, promise);
  try {
    return await promise;
  } finally {
    attachPromises.delete(id);
  }
}

export async function detach(tabId) {
  const id = Number(tabId);
  if (!attached.has(id)) return;
  attached.delete(id);
  try {
    await chrome.debugger.detach({ tabId: id });
  } catch {
    /* already gone */
  }
}

export async function detachAll() {
  const ids = [...attached.keys()];
  await Promise.allSettled(ids.map((id) => detach(id)));
}

export async function sendCommand(tabId, method, params = {}, timeoutMs = 20000) {
  const id = Number(tabId);
  const info = await attach(id);
  if (info?.foreign) {
    throw new Error(
      'Another debugger is attached to this tab. Close DevTools and try again.'
    );
  }
  return sendRaw(id, method, params, timeoutMs);
}

function sendRaw(tabId, method, params = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Browser command timed out: ${method}`));
    }, timeoutMs);
    try {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result);
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

export async function startCapture(tabId) {
  await attach(tabId);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

const MODIFIER_BITS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, win: 4, windows: 4, shift: 8 };

export function modifierMask(modifiers) {
  let mask = 0;
  for (const part of String(modifiers || '')
    .toLowerCase()
    .split('+')) {
    mask |= MODIFIER_BITS[part.trim()] || 0;
  }
  return mask;
}

export async function click(tabId, { x, y, button = 'left', clickCount = 1, modifiers = 0 }) {
  const commandButton =
    button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left';
  const buttons = commandButton === 'right' ? 2 : commandButton === 'middle' ? 4 : 1;
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    modifiers,
    button: 'none',
    buttons: 0
  });
  for (let count = 1; count <= Math.max(1, clickCount); count++) {
    await sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: commandButton,
      buttons,
      clickCount: count,
      modifiers
    });
    await sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: commandButton,
      buttons: 0,
      clickCount: count,
      modifiers
    });
    if (count < clickCount) await sleep(40);
  }
  await sleep(120);
  return { x, y, button: commandButton, clickCount };
}

export async function moveMouse(tabId, { x, y, modifiers = 0 }) {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    modifiers,
    button: 'none',
    buttons: 0
  });
  return { x, y };
}

export async function drag(tabId, { fromX, fromY, toX, toY, modifiers = 0 }) {
  const steps = 12;
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: fromX,
    y: fromY,
    modifiers
  });
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: fromX,
    y: fromY,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    modifiers
  });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: fromX + (toX - fromX) * t,
      y: fromY + (toY - fromY) * t,
      button: 'left',
      buttons: 1,
      modifiers
    });
    await sleep(12);
  }
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: toX,
    y: toY,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    modifiers
  });
  return { from: [fromX, fromY], to: [toX, toY] };
}

export async function scrollWheel(tabId, { x, y, deltaX = 0, deltaY = 0, modifiers = 0 }) {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX,
    deltaY,
    modifiers,
    button: 'none',
    buttons: 0
  });
  return { x, y, deltaX, deltaY };
}

export async function insertText(tabId, text) {
  await sendCommand(tabId, 'Input.insertText', { text: String(text ?? '') });
  return { text: String(text ?? '') };
}

const KEY_TABLE = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' }
};
for (let i = 1; i <= 12; i++) {
  KEY_TABLE[`F${i}`] = {
    key: `F${i}`,
    code: `F${i}`,
    keyCode: 111 + i
  };
}

export function parseKeyCombo(combo) {
  const raw = String(combo || '').trim();
  if (!raw) throw new Error('No key was provided.');
  const parts = raw.split('+').map((part) => part.trim());
  const keyName = parts.pop() || '';
  let modifiers = 0;
  for (const part of parts) modifiers |= MODIFIER_BITS[part.toLowerCase()] || 0;
  const base = KEY_TABLE[keyName] || KEY_TABLE[keyName.charAt(0).toUpperCase() + keyName.slice(1)];
  if (base) {
    return {
      ...base,
      modifiers,
      text: modifiers ? undefined : base.text
    };
  }
  if (keyName.length === 1) {
    const upper = keyName.toUpperCase();
    const code = /[A-Z]/.test(upper)
      ? `Key${upper}`
      : /[0-9]/.test(upper)
        ? `Digit${upper}`
        : keyName === ' '
          ? 'Space'
          : '';
    return {
      key: keyName,
      code,
      keyCode: upper.charCodeAt(0),
      text: modifiers ? undefined : keyName,
      modifiers
    };
  }
  throw new Error(`Unsupported key: ${keyName}`);
}

export async function pressKey(tabId, combo) {
  const parsed = parseKeyCombo(combo);
  const base = {
    modifiers: parsed.modifiers,
    key: parsed.key,
    code: parsed.code,
    windowsVirtualKeyCode: parsed.keyCode,
    nativeVirtualKeyCode: parsed.keyCode
  };
  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: parsed.text ? 'keyDown' : 'rawKeyDown',
    ...base,
    text: parsed.text,
    unmodifiedText: parsed.text
  });
  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    ...base
  });
  return { key: combo };
}

/* ------------------------------------------------------------------ */
/* Screenshots                                                         */
/* ------------------------------------------------------------------ */

export async function captureScreenshot(
  tabId,
  { x = 0, y = 0, width, height, scale = 1, format = 'png' } = {}
) {
  const metrics = await sendCommand(tabId, 'Page.getLayoutMetrics');
  const viewport =
    metrics.cssVisualViewport || metrics.visualViewport || metrics.layoutViewport;
  const vw = Math.max(1, Math.round(viewport?.clientWidth || viewport?.width || 1280));
  const vh = Math.max(
    1,
    Math.round(viewport?.clientHeight || viewport?.height || 800)
  );
  const clipX = Math.max(0, Math.min(vw - 1, x));
  const clipY = Math.max(0, Math.min(vh - 1, y));
  const clipW = Math.max(1, Math.min(vw - clipX, width || vw));
  const clipH = Math.max(1, Math.min(vh - clipY, height || vh));
  const clampedScale = Math.max(0.1, Math.min(1, scale || 1));
  const result = await sendCommand(tabId, 'Page.captureScreenshot', {
    format,
    fromSurface: true,
    captureBeyondViewport: false,
    clip: {
      x: clipX,
      y: clipY,
      width: clipW,
      height: clipH,
      scale: clampedScale
    }
  });
  return {
    base64: result.data,
    format,
    viewportWidth: vw,
    viewportHeight: vh,
    cssX: clipX,
    cssY: clipY,
    cssWidth: clipW,
    cssHeight: clipH,
    width: Math.round(clipW * clampedScale),
    height: Math.round(clipH * clampedScale),
    scale: clampedScale
  };
}

/* ------------------------------------------------------------------ */
/* Console & network capture                                           */
/* ------------------------------------------------------------------ */

function installListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  chrome.debugger.onEvent.addListener(onEvent);
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) {
      attached.delete(source.tabId);
      networkRequests.delete(source.tabId);
    }
  });
}

function ensureBuffer(map, tabId, factory) {
  if (!map.has(tabId)) map.set(tabId, factory());
  return map.get(tabId);
}

function onEvent(source, method, params) {
  const tabId = source.tabId;
  if (!tabId) return;
  if (method === 'Runtime.consoleAPICalled') {
    const level = params.type === 'warning' ? 'warn' : params.type;
    const text = (params.args || []).map(remoteObjectText).join(' ');
    pushConsole(tabId, {
      level,
      text,
      timestamp: params.timestamp || Date.now(),
      url: params.stackTrace?.callFrames?.[0]?.url || ''
    });
    return;
  }
  if (method === 'Runtime.exceptionThrown') {
    const details = params.exceptionDetails || {};
    const text =
      details.exception?.description ||
      details.text ||
      'Uncaught exception';
    pushConsole(tabId, {
      level: 'error',
      text,
      timestamp: params.timestamp || Date.now(),
      url: details.url || details.stackTrace?.callFrames?.[0]?.url || '',
      line: details.lineNumber
    });
    return;
  }
  if (method === 'Log.entryAdded') {
    const entry = params.entry || {};
    pushConsole(tabId, {
      level: entry.level || 'info',
      text: entry.text || '',
      timestamp: entry.timestamp || Date.now(),
      url: entry.url || '',
      line: entry.lineNumber
    });
    return;
  }
  if (method === 'Network.requestWillBeSent') {
    const req = params.request || {};
    const requests = ensureBuffer(networkRequests, tabId, () => new Map());
    if (requests.size >= MAX_BUFFER) {
      const first = requests.keys().next().value;
      requests.delete(first);
    }
    if (params.type === 'Document' && req.url) {
      try {
        const host = new URL(req.url).hostname;
        const previous = lastHost.get(tabId);
        if (previous && previous !== host) {
          requests.clear();
        }
        lastHost.set(tabId, host);
      } catch {
        /* ignore */
      }
    }
    requests.set(params.requestId, {
      id: params.requestId,
      method: req.method || 'GET',
      url: req.url || '',
      type: params.type || 'Other',
      startTime: params.timestamp || Date.now() / 1000,
      status: null,
      mimeType: '',
      size: 0,
      duration: 0,
      fromCache: false,
      failed: ''
    });
    return;
  }
  if (method === 'Network.responseReceived') {
    const requests = networkRequests.get(tabId);
    const record = requests?.get(params.requestId);
    if (record) {
      const response = params.response || {};
      record.status = response.status ?? record.status;
      record.mimeType = response.mimeType || record.mimeType;
      record.fromCache = !!response.fromDiskCache || !!response.fromPrefetchCache;
      record.protocol = response.protocol || '';
    }
    return;
  }
  if (method === 'Network.loadingFinished') {
    const requests = networkRequests.get(tabId);
    const record = requests?.get(params.requestId);
    if (record) {
      record.size = params.encodedDataLength || record.size;
      record.duration = Math.max(
        0,
        (params.timestamp - record.startTime) * 1000
      );
    }
    return;
  }
  if (method === 'Network.loadingFailed') {
    const requests = networkRequests.get(tabId);
    const record = requests?.get(params.requestId);
    if (record) {
      record.failed = params.errorText || 'failed';
      record.duration = Math.max(
        0,
        (params.timestamp - record.startTime) * 1000
      );
    }
  }
}

function remoteObjectText(arg) {
  if (!arg) return '';
  if ('value' in arg && arg.value !== undefined) {
    if (typeof arg.value === 'string') return arg.value;
    try {
      return JSON.stringify(arg.value);
    } catch {
      return String(arg.value);
    }
  }
  if (arg.unserializableValue) return String(arg.unserializableValue);
  if (arg.description) return arg.description;
  if (arg.type === 'undefined') return 'undefined';
  if (arg.type === 'function') return '[Function]';
  return arg.type || '';
}

function pushConsole(tabId, entry) {
  const buffer = ensureBuffer(consoleBuffers, tabId, () => []);
  buffer.push({ ...entry, text: String(entry.text || '').slice(0, 8000) });
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
}

export async function readConsoleMessages(
  tabId,
  { pattern = '', limit = 100, clear = false } = {}
) {
  await startCapture(tabId);
  const buffer = consoleBuffers.get(Number(tabId)) || [];
  const matcher = compileMatcher(pattern);
  const filtered = buffer.filter((entry) =>
    matcher(`${entry.level} ${entry.text} ${entry.url}`)
  );
  const max = Math.max(1, Math.min(500, Number(limit) || 100));
  const out = filtered.slice(-max);
  if (clear) consoleBuffers.set(Number(tabId), []);
  return { messages: out, total: filtered.length, captured: buffer.length };
}

export async function readNetworkRequests(
  tabId,
  { pattern = '', limit = 100, clear = false } = {}
) {
  await startCapture(tabId);
  const requests = networkRequests.get(Number(tabId)) || new Map();
  const matcher = compileMatcher(pattern);
  const list = [...requests.values()]
    .filter((record) => matcher(`${record.method} ${record.url} ${record.status}`))
    .slice(-Math.max(1, Math.min(500, Number(limit) || 100)));
  if (clear) requests.clear();
  return {
    requests: list.map((record) => ({
      method: record.method,
      url: record.url,
      status: record.status,
      type: record.type,
      mimeType: record.mimeType,
      size: record.size,
      durationMs: Math.round(record.duration),
      fromCache: record.fromCache,
      failed: record.failed
    })),
    total: list.length,
    captured: requests.size
  };
}

function compileMatcher(pattern) {
  const raw = String(pattern || '').trim();
  if (!raw) return () => true;
  const regex = /^\/(.+)\/([a-z]*)$/i.exec(raw);
  if (regex) {
    try {
      const re = new RegExp(regex[1], regex[2]);
      return (text) => re.test(text);
    } catch {
      /* fall through */
    }
  }
  const needle = raw.toLowerCase();
  return (text) => String(text || '').toLowerCase().includes(needle);
}

export function clearBuffers(tabId) {
  consoleBuffers.delete(Number(tabId));
  networkBuffers.delete(Number(tabId));
  networkRequests.delete(Number(tabId));
}
