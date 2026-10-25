/**
 * Settings storage and normalization.
 *
 * API keys live in chrome.storage.local by default. Users can opt in to
 * session-only keys, which live in chrome.storage.session and disappear when
 * the browser closes.
 */

import {
  STORAGE_KEYS,
  PROVIDER_PRESETS,
  PERMISSION_MODES
} from './constants.js';

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  activeProfileId: null,
  profiles: [],
  agent: {
    maxSteps: 20,
    temperature: 0.7,
    maxOutputTokens: 4096,
    groupTabs: true,
    trustedInput: true,
    animations: true,
    screenshotMaxWidth: 1280,
    screenshotScale: 1,
    includePageContext: true,
    includeSelectedText: true,
    enterToSend: true,
    showReasoning: false,
    javascriptTool: false,
    confirmDomainChanges: true,
    openNewTabOnRestricted: true,
    newTabUrl: 'https://www.google.com',
    maxHistoryMessages: 80,
    maxContextChars: 120000,
    keepScreenshots: 2,
    streamResponses: true
  },
  permissions: {
    mode: PERMISSION_MODES.ASK,
    rules: {}
  },
  ui: {
    theme: 'system',
    density: 'comfortable',
    showWelcome: true
  },
  customInstructions: '',
  tasks: [],
  mcpServers: [],
  skills: [
    {
      id: 'summarize',
      name: 'Summarize',
      icon: 'sparkles',
      description: 'Turn a long page into a short, useful brief.',
      instructions:
        'Read the current page carefully. Then produce a tight summary: the main point in one sentence, 3-6 key facts, and any decisions or next actions. Skip boilerplate, nav, ads, and legal fine print unless it matters.',
      enabled: false
    },
    {
      id: 'compare',
      name: 'Compare tabs',
      icon: 'columns',
      description: 'Compare products, articles, or options across tabs.',
      instructions:
        'Inspect the tabs the user points to. Build a comparison table with consistent criteria, then recommend an option and explain the tradeoffs. Cite the tab titles. Do not invent missing values; mark them unknown.',
      enabled: false
    },
    {
      id: 'debug-page',
      name: 'Debug page',
      icon: 'terminal',
      description: 'Find console and network problems on a page.',
      instructions:
        'Use read_console_messages and read_network_requests to diagnose the current page. Correlate errors with failing requests. Report the root cause, evidence, and a concrete fix. Do not run JavaScript unless explicitly allowed.',
      enabled: false
    }
  ]
});

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function deepMerge(base, override) {
  if (!isPlainObject(base)) return override === undefined ? base : override;
  const out = { ...base };
  if (!isPlainObject(override)) return out;
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else if (Array.isArray(value)) {
      out[key] = value.slice();
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export function normalizeSettings(raw) {
  const merged = deepMerge(DEFAULT_SETTINGS, raw || {});
  merged.agent.maxSteps = clampInt(merged.agent.maxSteps, 1, 50, 20);
  merged.agent.maxOutputTokens = clampInt(
    merged.agent.maxOutputTokens,
    128,
    32000,
    4096
  );
  merged.agent.maxHistoryMessages = clampInt(
    merged.agent.maxHistoryMessages,
    8,
    400,
    80
  );
  merged.agent.maxContextChars = clampInt(
    merged.agent.maxContextChars,
    8000,
    1000000,
    120000
  );
  merged.agent.keepScreenshots = clampInt(
    merged.agent.keepScreenshots,
    0,
    10,
    2
  );
  merged.agent.screenshotMaxWidth = clampInt(
    merged.agent.screenshotMaxWidth,
    480,
    2400,
    1280
  );
  merged.agent.temperature = Math.max(
    0,
    Math.min(2, Number(merged.agent.temperature) || 0)
  );
  merged.agent.screenshotScale = Math.max(
    0.25,
    Math.min(1, Number(merged.agent.screenshotScale) || 1)
  );
  merged.agent.newTabUrl =
    typeof merged.agent.newTabUrl === 'string' &&
    /^https?:\/\//i.test(merged.agent.newTabUrl.trim())
      ? merged.agent.newTabUrl.trim()
      : 'https://www.google.com';
  if (!Object.values(PERMISSION_MODES).includes(merged.permissions.mode)) {
    merged.permissions.mode = PERMISSION_MODES.ASK;
  }
  if (!isPlainObject(merged.permissions.rules)) {
    merged.permissions.rules = {};
  }
  merged.profiles = (Array.isArray(merged.profiles) ? merged.profiles : [])
    .filter((p) => p && typeof p === 'object' && p.id)
    .map(normalizeProfile);
  if (merged.profiles.length > 0) {
    if (!merged.activeProfileId) merged.activeProfileId = merged.profiles[0].id;
    if (!merged.profiles.some((p) => p.id === merged.activeProfileId)) {
      merged.activeProfileId = merged.profiles[0].id;
    }
  } else {
    merged.activeProfileId = null;
  }
  if (!Array.isArray(merged.skills)) merged.skills = [];
  merged.skills = merged.skills
    .filter((s) => s && typeof s === 'object' && s.id)
    .map((s) => ({
      id: String(s.id),
      name: String(s.name || 'Untitled skill').slice(0, 80),
      icon: String(s.icon || 'sparkles'),
      description: String(s.description || '').slice(0, 240),
      instructions: String(s.instructions || ''),
      enabled: s.enabled !== false
    }));
  merged.tasks = (Array.isArray(merged.tasks) ? merged.tasks : [])
    .filter((task) => task && typeof task === 'object' && task.id)
    .map((task) => ({
      id: String(task.id),
      name: String(task.name || 'Scheduled task').slice(0, 100),
      prompt: String(task.prompt || ''),
      url: String(task.url || 'about:blank'),
      enabled: task.enabled !== false,
      frequency: ['daily', 'weekly', 'manual'].includes(task.frequency)
        ? task.frequency
        : 'manual',
      time: /^\d{2}:\d{2}$/.test(String(task.time || ''))
        ? String(task.time)
        : '09:00',
      day: Math.max(0, Math.min(6, Number(task.day) || 1)),
      lastRun: Number(task.lastRun) || 0,
      lastResult: String(task.lastResult || '').slice(0, 4000),
      lastError: String(task.lastError || '').slice(0, 2000)
    }));
  merged.mcpServers = (Array.isArray(merged.mcpServers) ? merged.mcpServers : [])
    .filter((server) => server && typeof server === 'object' && server.url)
    .map((server) => ({
      id: String(server.id || `mcp_${Math.random().toString(36).slice(2, 8)}`),
      name: String(server.name || 'MCP server').slice(0, 80),
      url: String(server.url || '').trim(),
      headers:
        server.headers && typeof server.headers === 'object'
          ? { ...server.headers }
          : {},
      enabled: server.enabled !== false
    }));
  return merged;
}

export function normalizeProfile(profile) {
  const out = {
    id: String(profile.id),
    name: String(profile.name || 'Untitled provider').slice(0, 80),
    type: profile.type === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: String(profile.baseUrl || '').trim(),
    model: String(profile.model || '').trim(),
    apiKey: typeof profile.apiKey === 'string' ? profile.apiKey : '',
    authStyle: ['bearer', 'x-api-key', 'api-key', 'none'].includes(
      profile.authStyle
    )
      ? profile.authStyle
      : 'bearer',
    supportsImages: profile.supportsImages !== false,
    maxOutputTokens: clampInt(profile.maxOutputTokens, 128, 32000, 4096),
    contextWindow: clampInt(profile.contextWindow, 8000, 2000000, 128000),
    temperature:
      profile.temperature === undefined || profile.temperature === null
        ? undefined
        : Math.max(0, Math.min(2, Number(profile.temperature) || 0)),
    headers: isPlainObject(profile.headers) ? { ...profile.headers } : {},
    query: typeof profile.query === 'string' ? profile.query : '',
    includeCacheControl: profile.includeCacheControl !== false,
    preset: typeof profile.preset === 'string' ? profile.preset : '',
    sessionOnlyKey: profile.sessionOnlyKey === true,
    createdAt: Number(profile.createdAt) || Date.now(),
    updatedAt: Number(profile.updatedAt) || Date.now()
  };
  return out;
}

export function createProfile(presetKey = 'anthropic', overrides = {}) {
  const preset = PROVIDER_PRESETS[presetKey] || PROVIDER_PRESETS.custom;
  const id =
    (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const headers = { ...(preset.headers || {}) };
  if (presetKey.startsWith('opencodeGo') && !headers['x-opencode-session']) {
    headers['x-opencode-session'] =
      (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) ||
      `myna_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  return normalizeProfile({
    id,
    name: preset.label,
    type: preset.type,
    baseUrl: preset.baseUrl,
    model: preset.model,
    authStyle: preset.authStyle,
    supportsImages: preset.supportsImages,
    maxOutputTokens: preset.maxOutputTokens,
    contextWindow: preset.contextWindow,
    headers,
    query: preset.query || '',
    includeCacheControl: preset.includeCacheControl === true,
    preset: presetKey,
    ...overrides
  });
}

export function getActiveProfile(settings) {
  if (!settings || !settings.profiles) return null;
  return (
    settings.profiles.find((p) => p.id === settings.activeProfileId) ||
    settings.profiles[0] ||
    null
  );
}

export function profileHasCredentials(profile) {
  if (!profile) return false;
  return profile.authStyle === 'none' || !!profile.apiKey;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/* ------------------------------------------------------------------ */
/* chrome.storage wrappers                                             */
/* ------------------------------------------------------------------ */

function hasChromeStorage() {
  return (
    typeof chrome !== 'undefined' &&
    chrome.storage &&
    chrome.storage.local &&
    chrome.storage.session
  );
}

export async function loadSettings() {
  if (!hasChromeStorage()) return normalizeSettings(DEFAULT_SETTINGS);
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const raw = stored[STORAGE_KEYS.SETTINGS];
  const settings = normalizeSettings(raw);
  // Merge session-only keys that are not persisted in local storage.
  const session = await chrome.storage.session.get(
    STORAGE_KEYS.SESSION_SECRETS
  );
  const secrets = session[STORAGE_KEYS.SESSION_SECRETS] || {};
  for (const profile of settings.profiles) {
    if (profile.sessionOnlyKey && secrets[profile.id]) {
      profile.apiKey = secrets[profile.id];
    }
  }
  return settings;
}

export async function saveSettings(settings) {
  if (!hasChromeStorage()) return settings;
  const normalized = normalizeSettings(settings);
  const toStore = {
    ...normalized,
    profiles: normalized.profiles.map((profile) =>
      profile.sessionOnlyKey ? { ...profile, apiKey: '' } : { ...profile }
    )
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: toStore });
  const secrets = {};
  for (const profile of normalized.profiles) {
    if (profile.sessionOnlyKey && profile.apiKey) {
      secrets[profile.id] = profile.apiKey;
    }
  }
  await chrome.storage.session.set({ [STORAGE_KEYS.SESSION_SECRETS]: secrets });
  return normalized;
}

export async function patchSettings(mutator) {
  const current = await loadSettings();
  const next = typeof mutator === 'function' ? mutator(current) : mutator;
  return saveSettings(next || current);
}

