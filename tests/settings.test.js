import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProfile,
  deepMerge,
  normalizeSettings,
  profileHasCredentials
} from '../src/lib/settings.js';
import {
  APPEARANCE_PRESETS,
  PERMISSION_PRESETS
} from '../src/lib/constants.js';
import {
  hostOf,
  isHttpUrl,
  isRestrictedUrl,
  joinApiUrl,
  joinEndpoint,
  truncate
} from '../src/lib/util.js';

test('settings merge defaults and normalize profiles', () => {
  const settings = normalizeSettings({
    agent: { maxSteps: 999, temperature: 9 },
    permissions: { mode: 'auto' },
    profiles: [
      {
        id: 'p1',
        name: 'Claude',
        type: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        apiKey: 'sk-test'
      }
    ]
  });
  assert.equal(settings.agent.maxSteps, 50);
  assert.equal(settings.agent.temperature, 2);
  assert.equal(settings.permissions.mode, 'auto');
  assert.equal(settings.profiles.length, 1);
  assert.equal(settings.activeProfileId, 'p1');
  assert.equal(profileHasCredentials(settings.profiles[0]), true);
  assert.equal(settings.agent.openNewTabOnRestricted, true);
  assert.equal(settings.agent.newTabUrl, 'https://www.google.com');
});

test('new-tab start page falls back to a safe URL', () => {
  const settings = normalizeSettings({
    agent: { newTabUrl: 'javascript:alert(1)' }
  });
  assert.equal(settings.agent.newTabUrl, 'https://www.google.com');
  const valid = normalizeSettings({
    agent: { newTabUrl: 'https://example.com/start' }
  });
  assert.equal(valid.agent.newTabUrl, 'https://example.com/start');
});

test('createProfile uses presets and allows credential-free local providers', () => {
  const ollama = createProfile('ollama');
  assert.equal(ollama.type, 'openai');
  assert.equal(ollama.authStyle, 'none');
  assert.equal(profileHasCredentials(ollama), true);
  const anthropic = createProfile('anthropic');
  assert.equal(anthropic.authStyle, 'x-api-key');
  assert.equal(profileHasCredentials(anthropic), false);
});

test('OpenCode Go preset uses the OpenAI endpoint and a routing session header', () => {
  const profile = createProfile('opencodeGo', { apiKey: 'test' });
  assert.equal(profile.type, 'openai');
  assert.equal(profile.authStyle, 'bearer');
  assert.equal(
    profile.baseUrl,
    'https://opencode.ai/inference/go/openai/v1'
  );
  assert.equal(profile.model, 'deepseek-v4.1-flash');
  assert.ok(profile.headers['x-opencode-session']);
  assert.equal(profileHasCredentials(profile), true);
});

test('OpenCode Go Anthropic preset targets the Messages endpoint', () => {
  const profile = createProfile('opencodeGoAnthropic', { apiKey: 'test' });
  assert.equal(profile.type, 'anthropic');
  assert.equal(profile.baseUrl, 'https://opencode.ai/inference/go/anthropic');
  assert.equal(profile.model, 'qwen3.8-flash');
  assert.ok(profile.headers['x-opencode-session']);
});

test('permission and appearance presets map to valid settings', () => {
  for (const preset of Object.values(PERMISSION_PRESETS)) {
    assert.ok(['ask', 'auto', 'readonly', 'plan'].includes(preset.mode));
    assert.ok(preset.label);
  }
  for (const preset of Object.values(APPEARANCE_PRESETS)) {
    assert.ok(['system', 'light', 'dark'].includes(preset.values.theme));
    assert.ok(['comfortable', 'compact'].includes(preset.values.density));
  }
});

test('deepMerge does not mutate inputs', () => {
  const base = { a: { b: 1 }, list: [1] };
  const next = deepMerge(base, { a: { c: 2 }, list: [2] });
  assert.deepEqual(next, { a: { b: 1, c: 2 }, list: [2] });
  assert.deepEqual(base, { a: { b: 1 }, list: [1] });
});

test('URL helpers join API roots without duplicating endpoints', () => {
  assert.equal(
    joinApiUrl('https://api.openai.com/v1', '/chat/completions'),
    'https://api.openai.com/v1/chat/completions'
  );
  assert.equal(
    joinApiUrl('https://api.openai.com/v1/chat/completions', '/chat/completions'),
    'https://api.openai.com/v1/chat/completions'
  );
  assert.equal(
    joinEndpoint(
      'https://example.openai.azure.com/openai/deployments/demo',
      '/chat/completions',
      'api-version=2024-10-21'
    ),
    'https://example.openai.azure.com/openai/deployments/demo/chat/completions?api-version=2024-10-21'
  );
});

test('URL guards reject browser-internal pages', () => {
  assert.equal(hostOf('https://www.Example.com/x'), 'www.example.com');
  assert.equal(isHttpUrl('https://example.com'), true);
  assert.equal(isHttpUrl('chrome://settings'), false);
  assert.equal(isRestrictedUrl('chrome://settings'), true);
  assert.equal(isRestrictedUrl('file:///C:/secret.txt'), true);
  assert.equal(isRestrictedUrl('https://chromewebstore.google.com/detail/x'), true);
  assert.equal(isRestrictedUrl('https://example.com'), false);
  assert.equal(isRestrictedUrl('https://opencode.ai/console/org_123'), false);
  assert.equal(isRestrictedUrl('chrome://settings'), true);
});

test('truncate keeps the tail marker', () => {
  assert.equal(truncate('abcdef', 5), 'abcd…');
  assert.equal(truncate('abc', 5), 'abc');
});
