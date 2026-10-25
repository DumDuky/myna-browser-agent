/** Small, dependency-free helpers shared by every surface. */

export function uid(prefix = '') {
  const id =
    globalThis.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}${id}` : id;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function truncate(text, max, note = '…') {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - note.length)) + note;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeTag(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

export function isRestrictedUrl(url) {
  const s = String(url || '');
  return (
    !s ||
    /^(chrome|edge|about|devtools|view-source|chrome-extension|moz-extension|file):/i.test(
      s
    ) ||
    /^https:\/\/chromewebstore\.google\.com\//i.test(s) ||
    /^https:\/\/chrome\.google\.com\/webstore\//i.test(s)
  );
}

export function cleanUrlForDisplay(url, max = 120) {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    u.hash = '';
    const out = u.toString();
    return truncate(out, max);
  } catch {
    return truncate(String(url || ''), max);
  }
}

export function redactUrl(url) {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/token|key|secret|auth|session|code|password/i.test(key)) {
        u.searchParams.set(key, '[redacted]');
      }
    }
    u.hash = '';
    return u.toString();
  } catch {
    return String(url || '');
  }
}

/**
 * Join a user-supplied base URL with an API path. Preserves query strings so
 * Azure-style endpoints work. Avoids doubling an endpoint the user already
 * included.
 */
export function joinApiUrl(baseUrl, path) {
  const raw = String(baseUrl || '').trim();
  if (!raw) throw new Error('Base URL is empty.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid URL. Include http:// or https://.`);
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const current = url.pathname.replace(/\/+$/, '');
  if (current.toLowerCase().endsWith(cleanPath.toLowerCase())) {
    return url.toString();
  }
  url.pathname = `${current}${cleanPath}`.replace(/\/{2,}/g, '/');
  return url.toString();
}

export function joinEndpoint(baseUrl, path, extraQuery = '') {
  const joined = joinApiUrl(baseUrl, path);
  if (!extraQuery) return joined;
  const url = new URL(joined);
  const query = extraQuery.startsWith('?') ? extraQuery.slice(1) : extraQuery;
  for (const [key, value] of new URLSearchParams(query)) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function parseJsonObject(text, label = 'JSON') {
  if (!text || !String(text).trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be an object.`);
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `Invalid ${label}: ${error instanceof Error ? error.message : error}`
    );
  }
}

export function safeParseJsonObject(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function estimateTokens(text) {
  const s = String(text ?? '');
  if (!s) return 0;
  return Math.ceil(s.length / 4);
}

export function formatRelativeTime(timestamp) {
  const diff = Date.now() - Number(timestamp || 0);
  if (!Number.isFinite(diff) || diff < 0) return 'just now';
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return '';
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(n / 60_000)}m ${Math.round((n % 60_000) / 1000)}s`;
}

export function sleepUntilAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function dataUrlParts(dataUrl) {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!match) return null;
  return {
    mediaType: match[1] || 'image/png',
    base64: match[2] || ''
  };
}

export function base64ToDataUrl(base64, mediaType = 'image/png') {
  return `data:${mediaType};base64,${base64}`;
}

export function formatError(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error.name === 'AbortError') return 'Stopped';
  return error.message || String(error);
}

export function humanizeToolName(name) {
  const map = {
    browser_batch: 'Batch actions',
    computer: 'Browser action',
    read_page: 'Read page',
    find: 'Find on page',
    form_input: 'Fill field',
    get_page_text: 'Extract text',
    navigate: 'Navigate',
    tabs_context: 'List tabs',
    tabs_create: 'New tab',
    tabs_close: 'Close tab',
    read_console_messages: 'Read console',
    read_network_requests: 'Read network',
    resize_window: 'Resize window',
    javascript_tool: 'Run JavaScript',
    update_plan: 'Plan',
    web_fetch: 'Fetch URL'
  };
  return map[name] || name;
}

export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm || `${singular}s`}`;
}

export function stripAnsi(text) {
  return String(text || '').replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-?]*[ -/]*[@-~]/g,
    ''
  );
}
