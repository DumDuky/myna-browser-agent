/** Chat session persistence. */

import { MAX_SESSIONS, STORAGE_KEYS } from '../lib/constants.js';
import { truncate, uid } from '../lib/util.js';

export function createSession({ tabId = null } = {}) {
  const now = Date.now();
  return {
    id: uid('chat_'),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    tabId,
    messages: [],
    approvedDomains: [],
    plan: null
  };
}

export function titleFromText(text) {
  const clean = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 'New chat';
  return truncate(clean, 58);
}

export function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const now = Date.now();
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .filter((message) => message && message.role)
        .slice(-400)
        .map(normalizeMessage)
    : [];
  return {
    id: String(raw.id || uid('chat_')),
    title: truncate(String(raw.title || 'New chat'), 90),
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
    tabId: Number.isFinite(raw.tabId) ? raw.tabId : null,
    messages,
    approvedDomains: Array.isArray(raw.approvedDomains)
      ? raw.approvedDomains.filter((item) => typeof item === 'string')
      : [],
    plan: raw.plan && typeof raw.plan === 'object' ? raw.plan : null
  };
}

function normalizeMessage(raw) {
  const message = {
    id: String(raw.id || uid('msg_')),
    role: raw.role,
    content: String(raw.content || ''),
    display: raw.display ? String(raw.display) : '',
    createdAt: Number(raw.createdAt) || Date.now(),
    imageCount: Number(raw.imageCount) || (raw.images?.length || 0),
    images: []
  };
  if (raw.role === 'assistant') {
    message.reasoning = String(raw.reasoning || '');
    message.toolCalls = Array.isArray(raw.toolCalls)
      ? raw.toolCalls.map((call) => ({
          id: String(call.id || uid('call_')),
          name: String(call.name || ''),
          input: call.input && typeof call.input === 'object' ? call.input : {},
          status: call.status || 'ok',
          plan: call.plan || null
        }))
      : [];
    message.usage = raw.usage && typeof raw.usage === 'object' ? raw.usage : null;
    message.stopReason = raw.stopReason || '';
  }
  if (raw.role === 'tool') {
    message.toolCallId = String(raw.toolCallId || '');
    message.name = String(raw.name || '');
    message.isError = !!raw.isError;
  }
  return message;
}

export function serializeSession(session) {
  return {
    ...session,
    messages: (session.messages || []).map((message) => {
      const copy = { ...message };
      if (copy.images?.length) {
        copy.imageCount = copy.images.length;
        // Screenshots and uploads can be large. Keep the text, drop the bytes.
        copy.images = [];
      }
      if (copy.toolCalls) {
        copy.toolCalls = copy.toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          input: call.input,
          status: call.status,
          plan: call.plan
        }));
      }
      if (copy.role === 'tool') {
        delete copy.data;
        delete copy.tabContext;
      }
      return copy;
    })
  };
}

export async function loadSessions() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SESSIONS);
  const raw = stored[STORAGE_KEYS.SESSIONS];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeSession)
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
}

export async function saveSessions(sessions) {
  const payload = (sessions || [])
    .slice(0, MAX_SESSIONS)
    .map(serializeSession);
  await chrome.storage.local.set({ [STORAGE_KEYS.SESSIONS]: payload });
}

export async function clearSessions() {
  await chrome.storage.local.remove(STORAGE_KEYS.SESSIONS);
}

export async function loadActiveSessionId() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_SESSION);
  return stored[STORAGE_KEYS.ACTIVE_SESSION] || null;
}

export async function saveActiveSessionId(id) {
  if (!id) {
    await chrome.storage.local.remove(STORAGE_KEYS.ACTIVE_SESSION);
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_SESSION]: id });
}

export function estimateSessionChars(session) {
  if (!session) return 0;
  let total = 0;
  for (const message of session.messages || []) {
    total += String(message.content || '').length;
    for (const call of message.toolCalls || []) {
      total += JSON.stringify(call.input || {}).length;
    }
  }
  return total;
}

export function toolResultMap(session) {
  const map = new Map();
  for (const message of session?.messages || []) {
    if (message.role === 'tool' && message.toolCallId) {
      map.set(message.toolCallId, message);
    }
  }
  return map;
}
