/**
 * Minimal MCP Streamable HTTP client.
 *
 * Supports the Streamable HTTP transport used by modern MCP servers. It does
 * not spawn stdio servers and does not implement the legacy GET/SSE transport;
 * those require a native host and are documented as a limitation.
 */

import { parseSSE } from './providers/sse.js';

const PROTOCOL_VERSION = '2024-11-05';

export class McpClient {
  constructor(server) {
    this.server = server;
    this.url = server.url;
    this.headers = { ...(server.headers || {}) };
    this.sessionId = '';
    this.nextId = 1;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return this;
    const response = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'Myna', version: '0.1.0' }
      }
    });
    if (response?.error) {
      throw new Error(response.error.message || 'MCP initialize failed.');
    }
    this.initialized = true;
    await this.post(
      {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      },
      { notification: true }
    ).catch(() => {});
    return this;
  }

  async listTools() {
    await this.initialize();
    const tools = [];
    let cursor;
    for (let page = 0; page < 10; page++) {
      const response = await this.post({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'tools/list',
        params: cursor ? { cursor } : {}
      });
      if (response?.error) {
        throw new Error(response.error.message || 'MCP tools/list failed.');
      }
      const result = response?.result || {};
      if (Array.isArray(result.tools)) tools.push(...result.tools);
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(name, args = {}) {
    await this.initialize();
    const response = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args }
    });
    if (response?.error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: response.error.message || 'MCP tool call failed.'
          }
        ]
      };
    }
    return response?.result || { content: [] };
  }

  async post(payload, { notification = false } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...this.headers
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (this.initialized) headers['MCP-Protocol-Version'] = PROTOCOL_VERSION;
    let response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        credentials: 'omit',
        cache: 'no-store',
        signal:
          typeof AbortSignal !== 'undefined' && AbortSignal.timeout
            ? AbortSignal.timeout(15000)
            : undefined
      });
    } catch (error) {
      throw new Error(
        `MCP request to ${this.server.name || this.url} failed: ${
          error instanceof Error ? error.message : error
        }`
      );
    }
    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    if (notification) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `MCP server returned ${response.status}: ${text.slice(0, 500)}`
      );
    }
    if (response.status === 202 || response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      for await (const event of parseSSE(response)) {
        if (!event.data || event.data === '[DONE]') continue;
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          continue;
        }
        if (data.id === payload.id) return data;
      }
      return null;
    }
    return response.json();
  }
}

export async function loadMcpTools(servers, { signal } = {}) {
  const clients = new Map();
  const tools = [];
  const errors = [];
  for (const server of servers || []) {
    if (!server.enabled || !server.url) continue;
    try {
      const client = new McpClient(server);
      const list = await client.listTools();
      clients.set(server.id, client);
      for (const tool of list) {
        if (!tool?.name) continue;
        const safeServer = String(server.id)
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .slice(0, 10);
        const safeTool = String(tool.name)
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .slice(0, 40);
        tools.push({
          name: `mcp__${safeServer}__${safeTool}`,
          description: `[${server.name}] ${tool.description || tool.name}`,
          inputSchema:
            tool.inputSchema &&
            typeof tool.inputSchema === 'object' &&
            tool.inputSchema.type
              ? tool.inputSchema
              : { type: 'object', properties: {} },
          mcp: { serverId: server.id, toolName: tool.name, server }
        });
      }
    } catch (error) {
      errors.push({
        server: server.name || server.url,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { clients, tools, errors };
}

export function mcpResultToTool(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const texts = [];
  const images = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'text' && typeof item.text === 'string') {
      texts.push(item.text);
    } else if (item.type === 'image' && item.data) {
      const mime = item.mimeType || 'image/png';
      images.push({
        dataUrl: `data:${mime};base64,${item.data}`,
        mediaType: mime
      });
    } else if (item.type === 'resource' && item.resource) {
      texts.push(
        typeof item.resource.text === 'string'
          ? item.resource.text
          : JSON.stringify(item.resource)
      );
    } else {
      texts.push(JSON.stringify(item));
    }
  }
  return {
    ok: !result?.isError,
    output: texts.join('\n\n') || '(MCP tool returned no text content)',
    images,
    isError: !!result?.isError
  };
}
