import test from 'node:test';
import assert from 'node:assert/strict';
import { toAnthropicMessages } from '../src/lib/providers/anthropic.js';
import { toOpenAIMessages } from '../src/lib/providers/openai.js';
import { withOpenCodeSession } from '../src/lib/providers/index.js';

const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZjr9wAAAABJRU5ErkJggg==';

test('OpenCode session header follows the conversation when the host matches', () => {
  const profile = {
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    headers: { 'x-opencode-session': 'profile-fallback', 'X-Test': '1' }
  };
  const next = withOpenCodeSession(profile, 'ses_123');
  assert.equal(next.headers['x-opencode-session'], 'ses_123');
  assert.equal(next.headers['X-Test'], '1');
  assert.equal(profile.headers['x-opencode-session'], 'profile-fallback');

  const other = withOpenCodeSession(
    { baseUrl: 'https://api.openai.com/v1', headers: {} },
    'ses_123'
  );
  assert.equal(other.headers['x-opencode-session'], undefined);
});

test('Anthropic conversion groups tool results and keeps images', () => {
  const messages = [
    { role: 'user', content: 'open the page', images: [image] },
    {
      role: 'assistant',
      content: 'I will click.',
      toolCalls: [
        { id: 'call_1', name: 'computer', input: { action: 'left_click' } },
        { id: 'call_2', name: 'read_page', input: {} }
      ]
    },
    {
      role: 'tool',
      toolCallId: 'call_1',
      name: 'computer',
      content: 'clicked'
    },
    {
      role: 'tool',
      toolCallId: 'call_2',
      name: 'read_page',
      content: 'page text',
      images: [image]
    },
    { role: 'user', content: 'now summarize' }
  ];
  const converted = toAnthropicMessages(messages, { supportsImages: true });
  assert.equal(converted[0].role, 'user');
  assert.equal(converted[0].content[0].type, 'text');
  assert.equal(converted[0].content[1].type, 'image');
  assert.equal(converted[1].role, 'assistant');
  assert.equal(converted[1].content[1].type, 'tool_use');
  assert.equal(converted[2].role, 'user');
  const results = converted[2].content.filter((b) => b.type === 'tool_result');
  assert.equal(results.length, 2);
  assert.equal(results[0].tool_use_id, 'call_1');
  assert.equal(results[1].content[1].type, 'image');
  assert.equal(converted[2].content.at(-1).type, 'text');
});

test('OpenAI conversion emits tool messages and screenshot image messages', () => {
  const messages = [
    { role: 'user', content: 'hello' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_1', name: 'computer', input: { action: 'screenshot' } }]
    },
    {
      role: 'tool',
      toolCallId: 'call_1',
      name: 'computer',
      content: 'screenshot captured',
      images: [image]
    }
  ];
  const converted = toOpenAIMessages('system prompt', messages, {
    supportsImages: true
  });
  assert.equal(converted[0].role, 'system');
  assert.equal(converted[2].role, 'assistant');
  assert.equal(converted[2].tool_calls[0].function.name, 'computer');
  assert.equal(converted[3].role, 'tool');
  assert.equal(converted[3].tool_call_id, 'call_1');
  assert.equal(converted[4].role, 'user');
  assert.equal(converted[4].content[1].type, 'image_url');
});

test('OpenAI conversion notes omitted images for text-only models', () => {
  const converted = toOpenAIMessages(
    'sys',
    [{ role: 'user', content: 'look', images: [image] }],
    { supportsImages: false }
  );
  assert.match(converted[1].content, /Image omitted/);
});
