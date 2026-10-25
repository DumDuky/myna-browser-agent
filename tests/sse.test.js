import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSSE } from '../src/lib/providers/sse.js';

function streamOf(chunks) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    })
  );
}

test('parseSSE handles chunk boundaries and multi-line data', async () => {
  const response = streamOf([
    'event: message\n',
    'data: {"type":"content_bl',
    'ock_delta","delta":{"type":"text_delta","text":"hel',
    'lo"}}\n\n',
    'data: second\n',
    'data: line\n\n'
  ]);
  const events = [];
  for await (const event of parseSSE(response)) events.push(event);
  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'message');
  assert.equal(
    JSON.parse(events[0].data).delta.text,
    'hello'
  );
  assert.equal(events[1].data, 'second\nline');
});

test('parseSSE ignores comments and handles CRLF', async () => {
  const response = streamOf([
    ': keepalive\r\n\r\n',
    'event: ping\r\n',
    'data: {}\r\n\r\n'
  ]);
  const events = [];
  for await (const event of parseSSE(response)) events.push(event);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'ping');
});
