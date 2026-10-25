/** Anthropic Messages API adapter (streaming and non-streaming). */

import { parseSSE, readErrorBody, providerHttpError } from './sse.js';
import {
  anthropicEndpoint,
  buildAuthHeaders,
  normalizeToolCalls,
  toImagePart
} from './shared.js';

export async function streamAnthropic({
  profile,
  system,
  messages,
  tools,
  settings,
  signal,
  onText,
  onReasoning,
  onUsage
}) {
  const endpoint = anthropicEndpoint(profile.baseUrl);
  const headers = buildAuthHeaders(profile);
  headers['anthropic-version'] = headers['anthropic-version'] || '2023-06-01';
  headers['anthropic-dangerous-direct-browser-access'] = 'true';

  const body = {
    model: profile.model,
    max_tokens:
      profile.maxOutputTokens || settings?.agent?.maxOutputTokens || 4096,
    temperature:
      profile.temperature === undefined
        ? settings?.agent?.temperature ?? 0.7
        : profile.temperature,
    system: buildSystem(system, profile),
    messages: toAnthropicMessages(messages, profile),
    tools: toAnthropicTools(tools, profile),
    stream: settings?.agent?.streamResponses !== false
  };
  if (!body.tools.length) delete body.tools;
  if (body.temperature === undefined) delete body.temperature;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
    credentials: 'omit',
    cache: 'no-store'
  });

  if (!response.ok) {
    throw providerHttpError(await readErrorBody(response), 'Anthropic');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!body.stream || !contentType.includes('text/event-stream')) {
    const json = await response.json();
    return parseAnthropicMessage(json, onText);
  }

  return parseAnthropicStream(response, { onText, onReasoning, onUsage });
}

function buildSystem(system, profile) {
  const text = String(system || '').trim();
  if (!text) return undefined;
  const block = { type: 'text', text };
  if (profile.includeCacheControl !== false) {
    block.cache_control = { type: 'ephemeral' };
  }
  return [block];
}

function toAnthropicTools(tools, profile) {
  const out = (tools || []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema || { type: 'object', properties: {} }
  }));
  if (out.length && profile.includeCacheControl !== false) {
    out[out.length - 1].cache_control = { type: 'ephemeral' };
  }
  return out;
}

export function toAnthropicMessages(messages, profile) {
  const out = [];
  const supportsImages = profile?.supportsImages !== false;

  const appendUserBlocks = (blocks) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === 'user') {
      last.content.push(...blocks);
    } else {
      out.push({ role: 'user', content: blocks });
    }
  };

  const appendAssistantBlocks = (blocks) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === 'assistant') {
      last.content.push(...blocks);
    } else {
      out.push({ role: 'assistant', content: blocks });
    }
  };

  for (const message of messages || []) {
    if (!message || !message.role) continue;
    if (message.role === 'user') {
      const blocks = [];
      const text = String(message.content || '').trim();
      if (text) blocks.push({ type: 'text', text });
      for (const image of message.images || []) {
        const part = toImagePart(image);
        if (part && supportsImages) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: part.mediaType,
              data: part.base64
            }
          });
        } else if (!supportsImages) {
          blocks.push({
            type: 'text',
            text: '[Image omitted: the selected model does not support image input.]'
          });
        }
      }
      appendUserBlocks(blocks);
      continue;
    }

    if (message.role === 'assistant') {
      const blocks = [];
      const text = String(message.content || '').trim();
      if (text) blocks.push({ type: 'text', text });
      for (const call of message.toolCalls || []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.input || {}
        });
      }
      appendAssistantBlocks(blocks);
      continue;
    }

    if (message.role === 'tool') {
      const content = [];
      const text = String(message.content ?? '');
      if (text) content.push({ type: 'text', text });
      for (const image of message.images || []) {
        const part = toImagePart(image);
        if (part && supportsImages) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: part.mediaType,
              data: part.base64
            }
          });
        }
      }
      if (!content.length) content.push({ type: 'text', text: '(no output)' });
      appendUserBlocks([
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content,
          ...(message.isError ? { is_error: true } : {})
        }
      ]);
    }
  }

  return out;
}

function parseAnthropicMessage(json, onText) {
  if (json?.error) {
    throw new Error(
      `Anthropic error: ${json.error.message || JSON.stringify(json.error)}`
    );
  }
  let text = '';
  let reasoning = '';
  const toolCalls = [];
  for (const block of json.content || []) {
    if (block.type === 'text') {
      text += block.text || '';
      onText?.(block.text || '');
    } else if (block.type === 'thinking') {
      reasoning += block.thinking || '';
    } else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, input: block.input });
    }
  }
  return {
    text,
    reasoning,
    toolCalls: normalizeToolCalls(toolCalls),
    stopReason: json.stop_reason || 'end_turn',
    usage: normalizeUsage(json.usage)
  };
}

async function parseAnthropicStream(response, { onText, onReasoning, onUsage }) {
  const blocks = new Map();
  let text = '';
  let reasoning = '';
  let stopReason = null;
  let usage = normalizeUsage();

  for await (const event of parseSSE(response)) {
    if (!event.data || event.data === '[DONE]') continue;
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      continue;
    }
    if (data.type === 'error') {
      throw new Error(
        `Anthropic error: ${
          data.error?.message || JSON.stringify(data.error || data)
        }`
      );
    }
    if (data.type === 'message_start') {
      usage = mergeUsage(usage, normalizeUsage(data.message?.usage));
      continue;
    }
    if (data.type === 'content_block_start') {
      const block = data.content_block || {};
      const entry = {
        type: block.type,
        id: block.id,
        name: block.name,
        text: block.text || '',
        json: '',
        input: block.input
      };
      blocks.set(data.index, entry);
      if (block.type === 'text' && block.text) {
        text += block.text;
        onText?.(block.text);
      }
      continue;
    }
    if (data.type === 'content_block_delta') {
      const entry = blocks.get(data.index);
      const delta = data.delta || {};
      if (delta.type === 'text_delta') {
        const chunk = delta.text || '';
        text += chunk;
        if (entry) entry.text += chunk;
        onText?.(chunk);
      } else if (delta.type === 'input_json_delta') {
        if (entry) entry.json += delta.partial_json || '';
      } else if (delta.type === 'thinking_delta') {
        const chunk = delta.thinking || '';
        reasoning += chunk;
        onReasoning?.(chunk);
      }
      continue;
    }
    if (data.type === 'content_block_stop') {
      const entry = blocks.get(data.index);
      if (entry && entry.type === 'tool_use') {
        let input = entry.input;
        if (entry.json.trim()) {
          try {
            input = JSON.parse(entry.json);
          } catch {
            input = { __raw: entry.json };
          }
        }
        entry.input = input || {};
      }
      continue;
    }
    if (data.type === 'message_delta') {
      stopReason = data.delta?.stop_reason || stopReason;
      usage = mergeUsage(usage, normalizeUsage(data.usage));
      if (data.usage && onUsage) onUsage(usage);
      continue;
    }
    if (data.type === 'message_stop') break;
  }

  const toolCalls = [];
  for (const entry of blocks.values()) {
    if (entry.type === 'tool_use' && entry.name) {
      toolCalls.push({
        id: entry.id,
        name: entry.name,
        input: entry.input || {}
      });
    }
  }
  return {
    text,
    reasoning,
    toolCalls: normalizeToolCalls(toolCalls),
    stopReason: stopReason || (toolCalls.length ? 'tool_use' : 'end_turn'),
    usage
  };
}

function normalizeUsage(usage) {
  if (!usage) return {};
  return {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    cache_read_input_tokens: usage.cache_read_input_tokens || 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens || 0
  };
}

function mergeUsage(a, b) {
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
