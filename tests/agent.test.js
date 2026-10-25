import test from 'node:test';
import assert from 'node:assert/strict';
import { fitMessages } from '../src/sidepanel/agent.js';
import { getToolDefinitions, TOOL_DEFINITIONS } from '../src/lib/tools-schema.js';

const settings = {
  agent: {
    maxHistoryMessages: 40,
    maxContextChars: 20000,
    keepScreenshots: 1
  }
};

test('fitMessages drops orphan tool messages and preserves assistant tool groups', () => {
  const messages = [
    { role: 'tool', toolCallId: 'orphan', content: 'orphan' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'read_page', input: {} }]
    },
    { role: 'tool', toolCallId: 'c1', content: 'page output' },
    { role: 'user', content: 'thanks' }
  ];
  const out = fitMessages(messages, settings);
  assert.equal(out[0].role, 'assistant');
  assert.equal(out[1].role, 'tool');
  assert.equal(out[2].role, 'user');
  assert.equal(out.some((m) => m.content === 'orphan'), false);
});

test('fitMessages keeps only the newest screenshots', () => {
  const img = (n) => `data:image/png;base64,${'A'.repeat(n)}`;
  const messages = [
    { role: 'user', content: 'one', images: [img(10)] },
    { role: 'assistant', content: 'two', toolCalls: [] },
    { role: 'user', content: 'three', images: [img(10)] }
  ];
  const out = fitMessages(messages, settings);
  const imageMessages = out.filter((m) => m.images?.length);
  assert.equal(imageMessages.length, 1);
  assert.equal(imageMessages[0].content, 'three');
});

test('fitMessages trims by character budget from the end', () => {
  const long = 'x'.repeat(9000);
  const messages = [
    { role: 'user', content: long },
    { role: 'assistant', content: 'a', toolCalls: [] },
    { role: 'user', content: long },
    { role: 'assistant', content: 'b', toolCalls: [] },
    { role: 'user', content: 'recent' }
  ];
  const out = fitMessages(messages, { agent: { maxHistoryMessages: 40, maxContextChars: 12000, keepScreenshots: 0 } });
  assert.equal(out.at(-1).content, 'recent');
  assert.ok(out.length < messages.length);
});

test('tool definitions hide javascript_tool unless enabled', () => {
  const normal = getToolDefinitions();
  const withJs = getToolDefinitions({ javascriptTool: true });
  assert.equal(normal.some((t) => t.name === 'javascript_tool'), false);
  assert.equal(withJs.some((t) => t.name === 'javascript_tool'), true);
  for (const tool of TOOL_DEFINITIONS) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.description.length > 20);
  }
});
