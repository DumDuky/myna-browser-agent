import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToPlainText } from '../src/lib/markdown.js';
import { estimateTokens, formatDuration, isRestrictedUrl, redactUrl } from '../src/lib/util.js';

test('markdownToPlainText strips common formatting', () => {
  const input = `# Title\n\n**bold** and *italic* with \`code\` and [link](https://example.com).\n\n\`\`\`js\nconst x = 1;\n\`\`\``;
  const out = markdownToPlainText(input);
  assert.match(out, /Title/);
  assert.match(out, /bold and italic with code and link/);
  assert.match(out, /const x = 1/);
  assert.doesNotMatch(out, /\*\*/);
});

test('redactUrl hides sensitive query parameters', () => {
  const out = redactUrl('https://example.com/cb?code=abc&state=xyz&normal=1');
  assert.match(out, /code=%5Bredacted%5D/);
  assert.match(out, /normal=1/);
});

test('misc formatting helpers', () => {
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(formatDuration(1500), '1.5s');
  assert.equal(isRestrictedUrl('chrome://extensions'), true);
});
