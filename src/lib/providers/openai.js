/** OpenAI Chat Completions adapter (works with most compatible providers). */

import { parseSSE, readErrorBody, providerHttpError } from './sse.js';
import {
  buildAuthHeaders,
  normalizeToolCalls,
  openAIEndpoint,
  toImagePart
} from './shared.js';

export async function streamOpenAI({
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
  const endpoint = openAIEndpoint(profile);
  const headers = buildAuthHeaders(profile);
  const stream = settings?.agent?.streamResponses !== false;
  const model = profile.model || '';

  const body = {
    model,
    messages: toOpenAIMessages(system, messages, profile),
    tools: toOpenAITools(tools),
    tool_choice: 'auto',
    stream
  };
  if (body.tools.length === 0) {
    delete body.tools;
    delete body.tool_choice;
  }
  const temperature =
    profile.temperature === undefined
      ? settings?.agent?.temperature ?? 0.7
      : profile.temperature;
  if (typeof temperature === 'number') body.temperature = temperature;

  const maxTokens =
    profile.maxOutputTokens || settings?.agent?.maxOutputTokens || 4096;
  const maxParam = maxTokensParameter(profile, model);
  body[maxParam] = maxTokens;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
    credentials: 'omit',
    cache: 'no-store'
  });

  if (!response.ok) {
    throw providerHttpError(
      await readErrorBody(response),
      profile.name || 'OpenAI-compatible'
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (!stream || !contentType.includes('text/event-stream')) {
    const json = await response.json();
    return parseOpenAIMessage(json, onText);
  }

  try {
    return await parseOpenAIStream(response, { onText, onReasoning, onUsage });
  } catch (error) {
    // Some gateways claim SSE but emit a JSON error body. Surface the message.
    if (/Unexpected token|Unexpected end of JSON/i.test(String(error?.message))) {
      throw new Error(
        'The provider returned a malformed streaming response. Try turning off streaming in Settings → Agent.'
      );
    }
    throw error;
  }
}

function maxTokensParameter(profile, model) {
  if (profile.maxTokensParam) return profile.maxTokensParam;
  if (/^(o[1-9]|gpt-5)/i.test(model)) return 'max_completion_tokens';
  return 'max_tokens';
}

export function toOpenAITools(tools) {
  return (tools || []).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: 'object', properties: {} }
    }
  }));
}

export function toOpenAIMessages(system, messages, profile) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  const supportsImages = profile?.supportsImages !== false;
  let pendingToolImages = [];

  const flushToolImages = () => {
    if (!pendingToolImages.length) return;
    const content = [
      {
        type: 'text',
        text: '[Screenshot captured by the previous tool call.]'
      }
    ];
    for (const image of pendingToolImages) content.push(image);
    out.push({ role: 'user', content });
    pendingToolImages = [];
  };

  for (const message of messages || []) {
    if (!message || !message.role) continue;
    if (message.role === 'user') {
      flushToolImages();
      const text = String(message.content || '');
      const images = message.images || [];
      if (images.length && supportsImages) {
        const content = [];
        if (text.trim()) content.push({ type: 'text', text });
        for (const dataUrl of images) {
          content.push({
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'auto' }
          });
        }
        out.push({ role: 'user', content });
      } else {
        const note =
          images.length && !supportsImages
            ? '\n\n[Image omitted: the selected model does not support image input.]'
            : '';
        out.push({ role: 'user', content: text + note });
      }
      continue;
    }

    if (message.role === 'assistant') {
      flushToolImages();
      const entry = {
        role: 'assistant',
        content: String(message.content || '') || null
      };
      const calls = (message.toolCalls || []).filter((c) => c && c.name);
      if (calls.length) {
        entry.tool_calls = calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.input || {})
          }
        }));
      }
      if (!entry.content && !entry.tool_calls) entry.content = '';
      out.push(entry);
      continue;
    }

    if (message.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: String(message.content ?? '') || '(no output)'
      });
      for (const image of message.images || []) {
        if (supportsImages) {
          const part = toImagePart(image);
          if (part) {
            pendingToolImages.push({
              type: 'image_url',
              image_url: {
                url: `data:${part.mediaType};base64,${part.base64}`,
                detail: 'auto'
              }
            });
          }
        }
      }
    }
  }
  flushToolImages();
  return out;
}

function parseOpenAIMessage(json, onText) {
  if (json?.error) {
    throw new Error(
      `Provider error: ${json.error.message || JSON.stringify(json.error)}`
    );
  }
  const choice = json?.choices?.[0];
  if (!choice) throw new Error('The provider returned no choices.');
  const message = choice.message || {};
  const text = normalizeContent(message.content);
  if (text) onText?.(text);
  const reasoning = message.reasoning_content || message.reasoning || '';
  const toolCalls = normalizeOpenAIToolCalls(message.tool_calls);
  return {
    text,
    reasoning,
    toolCalls,
    stopReason: choice.finish_reason || (toolCalls.length ? 'tool_calls' : 'stop'),
    usage: normalizeUsage(json.usage)
  };
}

async function parseOpenAIStream(response, { onText, onReasoning, onUsage }) {
  let text = '';
  let reasoning = '';
  let finishReason = null;
  let usage = {};
  const calls = new Map();

  const ensureCall = (index) => {
    if (!calls.has(index)) {
      calls.set(index, { id: '', name: '', arguments: '' });
    }
    return calls.get(index);
  };

  for await (const event of parseSSE(response)) {
    if (!event.data || event.data === '[DONE]') continue;
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      continue;
    }
    if (data.error) {
      throw new Error(
        `Provider error: ${data.error.message || JSON.stringify(data.error)}`
      );
    }
    if (data.usage) usage = normalizeUsage(data.usage);
    const choice = data.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta || {};
    const content = normalizeContent(delta.content);
    if (content) {
      text += content;
      onText?.(content);
    }
    const think = delta.reasoning_content || delta.reasoning;
    if (think) {
      reasoning += think;
      onReasoning?.(think);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const item of delta.tool_calls) {
        const index = Number.isInteger(item.index) ? item.index : 0;
        const call = ensureCall(index);
        if (item.id) call.id = item.id;
        if (item.function?.name) {
          call.name = call.name || item.function.name;
        }
        if (item.function?.arguments !== undefined) {
          call.arguments +=
            typeof item.function.arguments === 'string'
              ? item.function.arguments
              : JSON.stringify(item.function.arguments);
        }
      }
    }
    if (delta.function_call) {
      const call = ensureCall(0);
      if (delta.function_call.name) {
        call.name = call.name || delta.function_call.name;
      }
      if (delta.function_call.arguments !== undefined) {
        call.arguments +=
          typeof delta.function_call.arguments === 'string'
            ? delta.function_call.arguments
            : JSON.stringify(delta.function_call.arguments);
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  const toolCalls = [];
  for (const [index, call] of calls.entries()) {
    if (!call.name) continue;
    let input = {};
    const raw = call.arguments.trim();
    if (raw) {
      try {
        input = JSON.parse(raw);
      } catch {
        input = { __raw: raw };
      }
    }
    toolCalls.push({
      id: call.id || `call_${index}_${Math.random().toString(36).slice(2, 8)}`,
      name: call.name,
      input
    });
  }
  if (usage && onUsage) onUsage(usage);
  return {
    text,
    reasoning,
    toolCalls: normalizeToolCalls(toolCalls),
    stopReason:
      finishReason || (toolCalls.length ? 'tool_calls' : 'stop'),
    usage
  };
}

function normalizeOpenAIToolCalls(calls) {
  if (!Array.isArray(calls)) return [];
  return normalizeToolCalls(
    calls.map((call, index) => {
      let input = {};
      const args = call?.function?.arguments;
      if (typeof args === 'string' && args.trim()) {
        try {
          input = JSON.parse(args);
        } catch {
          input = { __raw: args };
        }
      } else if (args && typeof args === 'object') {
        input = args;
      }
      return {
        id: call?.id || `call_${index}`,
        name: call?.function?.name || call?.name || '',
        input
      };
    })
  );
}

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      if (part?.type === 'output_text') return part.text || '';
      return '';
    })
    .join('');
}

function normalizeUsage(usage) {
  if (!usage) return {};
  return {
    input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
    output_tokens: usage.completion_tokens || usage.output_tokens || 0,
    total_tokens: usage.total_tokens || 0
  };
}

