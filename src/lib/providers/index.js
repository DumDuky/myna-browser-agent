/** Provider registry and high-level helpers. */

import { streamAnthropic } from './anthropic.js';
import { streamOpenAI } from './openai.js';
import { openAIEndpoint, buildAuthHeaders } from './shared.js';
import { fetchJson } from './sse.js';

export async function streamChat(options) {
  const { profile } = options;
  if (!profile) throw new Error('No provider is configured.');
  if (!profile.model) throw new Error('No model is configured for this provider.');
  const effectiveProfile = withOpenCodeSession(profile, options.sessionId);
  const next = { ...options, profile: effectiveProfile };
  if (effectiveProfile.type === 'anthropic') return streamAnthropic(next);
  return streamOpenAI(next);
}

/**
 * OpenCode Go asks for a stable session ID per conversation so it can route
 * requests and reuse prompt caches. Keep a profile-level header as a fallback
 * for connection tests, but prefer the real conversation ID for chats.
 */
export function withOpenCodeSession(profile, sessionId) {
  if (!profile || !sessionId) return profile;
  let host = '';
  try {
    host = new URL(profile.baseUrl).hostname;
  } catch {
    return profile;
  }
  if (host !== 'opencode.ai' && !host.endsWith('.opencode.ai')) return profile;
  return {
    ...profile,
    headers: {
      ...(profile.headers || {}),
      'x-opencode-session': String(sessionId)
    }
  };
}

export async function testProfile(profile, { signal } = {}) {
  if (!profile) throw new Error('No provider is configured.');
  const started = Date.now();
  const result = await streamChat({
    profile,
    system: 'You are a connection test. Reply with exactly: OK',
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    tools: [],
    settings: { agent: { streamResponses: false, temperature: 0 } },
    signal,
    onText: () => {}
  });
  return {
    ok: true,
    latencyMs: Date.now() - started,
    model: result.text.trim().slice(0, 100) || '(empty response)'
  };
}

export async function fetchModels(profile, { signal } = {}) {
  if (!profile) throw new Error('No provider is configured.');
  if (profile.type === 'anthropic') {
    throw new Error(
      'Anthropic does not expose a public model list to browser clients. Type the model ID manually.'
    );
  }
  const endpoint = openAIEndpoint(profile).replace(
    /\/chat\/completions(\?.*)?$/i,
    '/models$1'
  );
  const headers = buildAuthHeaders(profile);
  const json = await fetchJson(endpoint, { headers, signal, cache: 'no-store' });
  const items = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.models)
      ? json.models
      : [];
  return items
    .map((item) => (typeof item === 'string' ? item : item?.id || item?.name))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export { buildAuthHeaders, openAIEndpoint };
