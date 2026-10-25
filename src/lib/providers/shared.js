/** Provider-neutral plumbing shared by the Anthropic and OpenAI adapters. */

import { dataUrlParts, joinApiUrl } from '../util.js';

export function buildAuthHeaders(profile) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if (profile.headers && typeof profile.headers === 'object') {
    for (const [key, value] of Object.entries(profile.headers)) {
      if (typeof value === 'string' && key.trim()) headers[key] = value;
    }
  }
  const key = String(profile.apiKey || '').trim();
  if (profile.authStyle === 'none') return headers;
  if (!key) throw new Error('No API key configured for this provider.');
  switch (profile.authStyle) {
    case 'x-api-key':
      headers['x-api-key'] = key;
      break;
    case 'api-key':
      headers['api-key'] = key;
      break;
    case 'bearer':
    default:
      headers.Authorization = `Bearer ${key}`;
      break;
  }
  return headers;
}

export function anthropicEndpoint(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (/\/v1\/messages\/?$/i.test(raw)) return joinApiUrl(raw, '');
  if (/\/v1\/?$/i.test(raw)) return joinApiUrl(raw, '/messages');
  return joinApiUrl(raw, '/v1/messages');
}

export function openAIEndpoint(profile) {
  const raw = String(profile.baseUrl || '').trim();
  const path = '/chat/completions';
  let endpoint;
  if (/\/chat\/completions\/?$/i.test(raw)) {
    endpoint = raw;
  } else {
    endpoint = joinApiUrl(raw, path);
  }
  if (profile.query) {
    const url = new URL(endpoint);
    const query = profile.query.startsWith('?')
      ? profile.query.slice(1)
      : profile.query;
    for (const [key, value] of new URLSearchParams(query)) {
      if (!url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    endpoint = url.toString();
  }
  return endpoint;
}

export function toImagePart(dataUrl, mediaTypeFallback = 'image/png') {
  const parts = dataUrlParts(dataUrl);
  if (!parts) return null;
  return {
    mediaType: parts.mediaType || mediaTypeFallback,
    base64: parts.base64
  };
}

export function normalizeToolCalls(toolCalls) {
  return (toolCalls || [])
    .filter((call) => call && call.name)
    .map((call) => ({
      id: call.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      name: call.name,
      input: call.input && typeof call.input === 'object' ? call.input : {}
    }));
}

export function mergeUsage(a, b) {
  return {
    input_tokens: (a?.input_tokens || 0) + (b?.input_tokens || 0),
    output_tokens: (a?.output_tokens || 0) + (b?.output_tokens || 0),
    cache_read_input_tokens:
      (a?.cache_read_input_tokens || 0) + (b?.cache_read_input_tokens || 0),
    cache_creation_input_tokens:
      (a?.cache_creation_input_tokens || 0) +
      (b?.cache_creation_input_tokens || 0)
  };
}

export function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && part.type === 'text') return part.text || '';
      return '';
    })
    .join('');
}

export function withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const onAbort = () => reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
      promise.finally(() => signal.removeEventListener('abort', onAbort));
    })
  ]);
}

export function abortError() {
  return new DOMException('Aborted', 'AbortError');
}
