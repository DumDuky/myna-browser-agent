/** Headless-ish runner for scheduled tasks (a normal extension page). */

import { loadSettings, getActiveProfile, profileHasCredentials } from '../lib/settings.js';
import { buildTurnContext } from '../lib/prompt.js';
import { loadMcpTools, mcpResultToTool } from '../lib/mcp.js';
import { runAgent } from '../sidepanel/agent.js';
import { createSession } from '../sidepanel/sessions.js';

const $ = (selector) => document.querySelector(selector);
const taskId = new URLSearchParams(location.search).get('taskId');
const logLines = [];

function log(line) {
  logLines.push(`${new Date().toLocaleTimeString()}  ${line}`);
  const el = $('#log');
  if (el) el.textContent = logLines.join('\n');
}

function status(text) {
  const el = $('#status');
  if (el) el.textContent = text;
}

function fill(percent) {
  const bar = $('#bar');
  if (bar) {
    bar.style.animation = 'none';
    bar.style.width = `${Math.max(4, Math.min(100, percent))}%`;
    bar.style.transform = 'none';
  }
}

let finalText = '';
let finished = false;
let targetTabId = null;

async function main() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'myna.permission_request') {
      if (
        message.tabId !== undefined &&
        targetTabId !== null &&
        Number(message.tabId) !== Number(targetTabId)
      ) {
        return false;
      }
      log(`Permission requested: ${message.summary || message.toolName}`);
      status('A permission prompt needs the side panel. Denying for this scheduled run.');
      sendResponse({ decision: 'deny' });
      return false;
    }
    return false;
  });

  if (!taskId) fail('No task ID was provided.');
  const settings = await loadSettings();
  const task = (settings.tasks || []).find((item) => item.id === taskId);
  if (!task) return fail('This scheduled task no longer exists.');
  $('#taskName').textContent = task.name || 'Scheduled task';
  log(`Starting “${task.name}”`);
  fill(8);

  const profile = getActiveProfile(settings);
  if (!profileHasCredentials(profile)) {
    return fail('No provider with credentials is configured.');
  }
  if (!task.prompt || !String(task.prompt).trim()) {
    return fail('This task has no prompt.');
  }

  const target = task.url && task.url !== 'about:blank' ? task.url : 'about:blank';
  status('Opening the page…');
  log(`Opening ${target}`);
  const tab = await chrome.tabs.create({ url: target, active: true });
  if (!tab.id) return fail('Chrome did not return a tab.');
  targetTabId = tab.id;
  fill(18);
  const ready = await waitForTab(tab.id, 25000);
  log(`Page ready: ${ready?.title || ready?.url || target}`);
  fill(28);

  let viewport = null;
  let selection = '';
  try {
    const info = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
        selection: String(window.getSelection() || '')
      })
    });
    const data = info?.[0]?.result;
    if (data) {
      viewport = { width: data.width, height: data.height, dpr: data.dpr };
      selection = data.selection || '';
    }
  } catch {
    /* viewport is optional */
  }

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const context = buildTurnContext({
    tab: { id: tab.id, title: ready?.title || '', url: ready?.url || target },
    tabs: tabs
      .filter((item) => item.id)
      .map((item) => ({
        id: item.id,
        title: item.title || '',
        url: item.url || '',
        active: !!item.active,
        groupId: item.groupId ?? -1
      })),
    mode: 'auto',
    selectedText: selection,
    viewport,
    includeSelectedText: false
  });

  const session = createSession({ tabId: tab.id });
  session.title = task.name || 'Scheduled task';
  session.messages.push({
    id: `msg_${crypto.randomUUID()}`,
    role: 'user',
    content: `${context}\n\nScheduled task: ${task.prompt}`,
    display: task.prompt,
    createdAt: Date.now()
  });

  const runSettings = {
    ...settings,
    agent: { ...settings.agent, confirmDomainChanges: false },
    permissions: { ...settings.permissions, mode: 'auto' }
  };

  let mcp = { tools: [], clients: new Map(), errors: [] };
  if (Array.isArray(settings.mcpServers) && settings.mcpServers.length) {
    status('Connecting MCP servers…');
    mcp = await loadMcpTools(settings.mcpServers);
    for (const error of mcp.errors) log(`MCP ${error.server}: ${error.error}`);
  }

  status('Myna is working…');
  fill(36);
  const result = await runAgent({
    session,
    profile,
    settings: runSettings,
    tab: { id: tab.id, title: ready?.title || '', url: ready?.url || target },
    tabs: [],
    viewport,
    mode: 'auto',
    groupId: null,
    files: [],
    skipDomainConfirm: true,
    extraTools: mcp.tools,
    executeMcpTool: async (call) => {
      const tool = mcp.tools.find((item) => item.name === call.name);
      if (!tool?.mcp) return { ok: false, error: `Unknown MCP tool ${call.name}` };
      const client = mcp.clients.get(tool.mcp.serverId);
      if (!client) return { ok: false, error: 'MCP server is not connected.' };
      try {
        const result = await client.callTool(tool.mcp.toolName, call.input || {});
        return mcpResultToTool(result);
      } catch (error) {
        return { ok: false, error: String(error.message || error) };
      }
    },
    signal: new AbortController().signal,
    hooks: {
      onStep: (step) => log(`Tool round ${step}`),
      onAssistantStart: () => {},
      onText: () => {},
      onAssistantDone: (message) => {
        if (message.content?.trim()) finalText = message.content.trim();
      },
      onToolStart: (assistant, call) => log(`Tool: ${call.name}`),
      onToolResult: (assistant, call, toolMessage) => {
        log(`Tool ${call.name}: ${toolMessage.isError ? 'error' : 'ok'}`);
      },
      requestPlan: async () => ({ approved: false }),
      onError: (error) => log(`Error: ${error.message || error}`)
    }
  });

  fill(92);
  if (result?.error) {
    await record({ error: result.error });
    return fail(result.error);
  }
  const text =
    finalText ||
    [...session.messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.content?.trim())
      ?.content ||
    'Task finished without a text result.';
  await record({ text });
  status('Done. The result is saved in Settings → Scheduled.');
  fill(100);
  await notify(task.name, text);
  setTimeout(() => closeWindow(), 1800);
}

async function record(payload) {
  try {
    await chrome.runtime.sendMessage({
      type: 'myna.record_task_result',
      taskId,
      result: payload
    });
  } catch {
    /* best effort */
  }
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('src/assets/icon-128.png'),
      title: `Myna: ${title || 'Scheduled task'}`,
      message: String(message || '').slice(0, 300)
    });
  } catch {
    /* notifications are optional */
  }
}

function fail(message) {
  if (finished) return;
  finished = true;
  status(message);
  log(`FAILED: ${message}`);
  notify('Scheduled task failed', message).catch(() => {});
  record({ error: message }).catch(() => {});
  fill(100);
  setTimeout(() => closeWindow(), 5000);
}

async function closeWindow() {
  try {
    const win = await chrome.windows.getCurrent();
    if (win?.id) await chrome.windows.remove(win.id);
  } catch {
    window.close();
  }
}

async function waitForTab(tabId, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      last = tab;
      if (tab.status === 'complete') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return tab;
      }
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return last;
}

main().catch((error) => fail(error.message || String(error)));
