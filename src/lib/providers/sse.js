/**
 * Server-sent events reader.
 *
 * Works with fetch Response bodies in Chrome extension pages, service workers,
 * and Node 18+ (tests). Yields { event, data, id } objects.
 */

export async function* parseSSE(response) {
  if (!response || !response.body) {
    throw new Error('The provider returned an empty response body.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawBlock = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseBlock(rawBlock);
        if (event) yield event;
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, '\n').trim();
    if (buffer) {
      const event = parseBlock(buffer);
      if (event) yield event;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

function parseBlock(rawBlock) {
  if (!rawBlock || !rawBlock.trim()) return null;
  let event = 'message';
  let id;
  const dataLines = [];
  for (const line of rawBlock.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
    else if (field === 'id') id = value;
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n'), id };
}

export async function readErrorBody(response) {
  let text = '';
  try {
    text = await response.text();
  } catch {
    /* ignore */
  }
  let detail = text;
  try {
    const json = JSON.parse(text);
    detail =
      json?.error?.message ||
      json?.error?.type ||
      json?.error ||
      json?.message ||
      text;
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch {
    /* keep raw text */
  }
  detail = String(detail || '').trim();
  if (detail.length > 1200) detail = detail.slice(0, 1200) + '…';
  return {
    status: response.status,
    statusText: response.statusText,
    detail: detail || `HTTP ${response.status}`
  };
}

export function providerHttpError({ status, statusText, detail }, provider) {
  const label = provider ? `${provider} API` : 'Provider API';
  let hint = '';
  if (status === 401 || status === 403) {
    hint = ' Check the API key and whether this key is allowed to use the model.';
  } else if (status === 404) {
    hint = ' Check the base URL and model ID.';
  } else if (status === 429) {
    hint = ' Rate limit or quota reached. Wait a moment or check your plan.';
  } else if (status >= 500) {
    hint = ' The provider had a server error. Try again.';
  }
  const statusLabel = statusText ? `${status} ${statusText}` : `${status}`;
  const error = new Error(`${label} error (${statusLabel}): ${detail}.${hint}`);
  error.status = status;
  error.detail = detail;
  error.provider = provider;
  return error;
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw providerHttpError(await readErrorBody(response), 'Provider');
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The provider returned a non-JSON response.');
  }
}
