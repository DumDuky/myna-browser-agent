/** The agent loop: model → tools → model, with plans and permissions. */

import { streamChat } from '../lib/providers/index.js';
import { getToolDefinitions } from '../lib/tools-schema.js';
import { buildSystemPrompt } from '../lib/prompt.js';
import { PERMISSION_MODES } from '../lib/constants.js';
import {
  escapeTag,
  formatError,
  truncate,
  uid
} from '../lib/util.js';

export class AgentStopped extends Error {
  constructor(message = 'Stopped') {
    super(message);
    this.name = 'AgentStopped';
  }
}

export async function runAgent({
  session,
  profile,
  settings,
  tab,
  tabs,
  viewport,
  mode,
  groupId,
  files = [],
  skipDomainConfirm = false,
  extraTools = [],
  executeMcpTool = null,
  signal,
  hooks
}) {
  const state = {
    tabId: tab?.id ?? null,
    groupId: groupId ?? null,
    files: Array.isArray(files) ? files : [],
    skipDomainConfirm: !!skipDomainConfirm,
    approvedDomains: new Set(session.approvedDomains || []),
    planApproved: false,
    steps: 0,
    usage: emptyUsage(),
    lastTabKey: tab ? `${tab.id}:${tab.url}` : ''
  };
  const maxSteps = Math.max(1, Number(settings.agent.maxSteps) || 20);
  const tools = [
    ...getToolDefinitions({
      javascriptTool: !!settings.agent.javascriptTool
    }),
    ...(Array.isArray(extraTools) ? extraTools : [])
  ];
  const system = buildSystemPrompt({
    mode,
    settings,
    profile,
    platform: platformName(),
    date: new Date()
  });

  try {
    while (state.steps < maxSteps) {
      if (signal?.aborted) throw new AgentStopped();
      state.steps++;
      hooks.onStep?.(state.steps);

      const providerMessages = fitMessages(session.messages, settings);
      const assistant = {
        id: uid('msg_'),
        role: 'assistant',
        content: '',
        reasoning: '',
        toolCalls: [],
        usage: null,
        stopReason: '',
        status: 'streaming',
        createdAt: Date.now()
      };
      session.messages.push(assistant);
      session.updatedAt = Date.now();
      hooks.onAssistantStart?.(assistant, session);

      let result;
      try {
        result = await streamChat({
          profile,
          sessionId: session.id,
          system,
          messages: providerMessages,
          tools,
          settings,
          signal,
          onText: (chunk) => {
            assistant.content += chunk;
            hooks.onText?.(assistant, session);
          },
          onReasoning: (chunk) => {
            assistant.reasoning += chunk;
            hooks.onReasoning?.(assistant, session);
          },
          onUsage: (usage) => {
            state.usage = mergeUsage(state.usage, usage);
            assistant.usage = state.usage;
            hooks.onUsage?.(assistant.usage, session);
          }
        });
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') {
          assistant.status = 'stopped';
          if (!assistant.content.trim()) {
            assistant.content = 'Stopped.';
          }
          hooks.onAssistantDone?.(assistant, session);
          throw new AgentStopped();
        }
        assistant.status = 'error';
        assistant.error = formatError(error);
        hooks.onAssistantDone?.(assistant, session);
        throw error;
      }

      assistant.content = result.text ?? assistant.content;
      assistant.reasoning = result.reasoning ?? assistant.reasoning;
      assistant.stopReason = result.stopReason || '';
      assistant.usage = mergeUsage(state.usage, result.usage || {});
      state.usage = assistant.usage;
      const calls = (result.toolCalls || []).map((call) => ({
        id: call.id || uid('call_'),
        name: call.name,
        input: call.input && typeof call.input === 'object' ? call.input : {},
        status: 'running'
      }));
      assistant.toolCalls = calls;
      assistant.status = calls.length ? 'tool_use' : 'done';
      if (!assistant.content.trim() && !calls.length) {
        assistant.content =
          result.stopReason === 'length'
            ? 'The model hit its output limit before finishing. Try a shorter request or raise the output limit in Settings.'
            : 'The model returned an empty response.';
      }
      hooks.onAssistantDone?.(assistant, session);

      if (!calls.length) break;
      if (signal?.aborted) throw new AgentStopped();

      for (const call of calls) {
        if (signal?.aborted) throw new AgentStopped();
        call.status = 'running';
        hooks.onToolStart?.(assistant, call, session);

        let toolMessage;
        try {
          if (call.name === 'update_plan') {
            toolMessage = await handlePlan({
              call,
              assistant,
              session,
              mode,
              state,
              hooks
            });
          } else if (call.name.startsWith('mcp__') && executeMcpTool) {
            const result = await executeMcpTool(call, assistant);
            toolMessage = {
              id: uid('msg_'),
              role: 'tool',
              toolCallId: call.id,
              name: call.name,
              content: result.ok
                ? String(result.output || 'MCP tool finished.')
                : `ERROR: ${result.error || result.output || 'MCP tool failed.'}`,
              isError: !result.ok,
              images: result.images || [],
              createdAt: Date.now()
            };
            session.messages.push(toolMessage);
          } else {
            toolMessage = await handleToolCall({
              call,
              assistant,
              session,
              state,
              mode,
              hooks
            });
          }
        } catch (error) {
          if (error instanceof AgentStopped) {
            call.status = 'stopped';
            throw error;
          }
          call.status = 'error';
          const message = formatError(error);
          toolMessage = {
            id: uid('msg_'),
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: `ERROR: ${message}`,
            isError: true,
            images: [],
            createdAt: Date.now()
          };
          session.messages.push(toolMessage);
        }

        if (!toolMessage) continue;
        if (toolMessage.isError) {
          call.status = 'error';
        } else if (call.status !== 'stopped') {
          call.status = 'ok';
        }
        hooks.onToolResult?.(assistant, call, toolMessage, session);
      }

      if (signal?.aborted) throw new AgentStopped();
      const hasMore = calls.some((call) => call.status !== 'stopped');
      if (!hasMore) break;
    }

    if (state.steps >= maxSteps) {
      const note = {
        id: uid('msg_'),
        role: 'assistant',
        content: `I stopped after ${maxSteps} tool rounds. Send “continue” if you want me to keep going, or tell me what to change.`,
        toolCalls: [],
        createdAt: Date.now(),
        status: 'done',
        usage: state.usage
      };
      session.messages.push(note);
      hooks.onAssistantStart?.(note, session);
      hooks.onAssistantDone?.(note, session);
    }
    session.updatedAt = Date.now();
    return { steps: state.steps, usage: state.usage };
  } catch (error) {
    if (error instanceof AgentStopped) {
      session.updatedAt = Date.now();
      return { stopped: true, steps: state.steps, usage: state.usage };
    }
    session.updatedAt = Date.now();
    hooks.onError?.(error);
    return { error: formatError(error), steps: state.steps, usage: state.usage };
  }
}

async function handleToolCall({ call, assistant, session, state, mode, hooks }) {
  const response = await sendToBackground({
    type: 'myna.tool',
    name: call.name,
    input: call.input,
    context: {
      tabId: state.tabId,
      groupId: state.groupId,
      mode,
      approvedDomains: [...state.approvedDomains],
      files: state.files,
      skipDomainConfirm: state.skipDomainConfirm,
      toolUseId: call.id
    }
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'The browser tool bridge failed.');
  }
  const result = response.result;
  if (!result) throw new Error('The tool returned no result.');

  const toolMessage = {
    id: uid('msg_'),
    role: 'tool',
    toolCallId: call.id,
    name: call.name,
    content: result.ok
      ? String(result.output || 'Done.')
      : `ERROR: ${result.error || 'Tool failed.'}`,
    isError: !result.ok,
    images: result.ok ? result.images || [] : [],
    data: result.ok ? result.data : null,
    tabContext: result.tabContext || null,
    createdAt: Date.now()
  };

  if (result.tabContext) {
    const nextTab = result.tabContext.currentTabId;
    if (nextTab) state.tabId = nextTab;
    if (result.tabContext.groupId !== undefined) {
      state.groupId = result.tabContext.groupId;
    }
    const title = result.tabContext.currentTitle || '';
    const url = result.tabContext.currentUrl || '';
    const key = `${state.tabId}:${url}`;
    if (key !== state.lastTabKey && url) {
      toolMessage.content += `\n\n<system-reminder>Current tab: [${state.tabId}] “${truncate(
        escapeTag(title),
        120
      )}” — ${escapeTag(truncate(url, 300))}</system-reminder>`;
      state.lastTabKey = key;
    }
  }
  if (result.data?.newTabId) {
    state.tabId = result.data.newTabId;
  }
  if (result.data?.groupId !== undefined) {
    state.groupId = result.data.groupId;
  }

  session.messages.push(toolMessage);
  return toolMessage;
}

async function handlePlan({ call, assistant, session, mode, state, hooks }) {
  const plan = {
    domains: Array.isArray(call.input.domains)
      ? call.input.domains.map(String).filter(Boolean).slice(0, 20)
      : [],
    approach: Array.isArray(call.input.approach)
      ? call.input.approach.map(String).filter(Boolean).slice(0, 12)
      : [],
    createdAt: Date.now()
  };
  if (mode === PERMISSION_MODES.PLAN && !state.planApproved) {
    call.plan = plan;
    const decision = await hooks.requestPlan?.(plan, assistant, call);
    if (!decision?.approved) {
      call.status = 'stopped';
      throw new AgentStopped('Plan cancelled by the user.');
    }
    state.planApproved = true;
    for (const domain of decision.domains || plan.domains) {
      state.approvedDomains.add(domain);
    }
    session.approvedDomains = [...state.approvedDomains];
    session.plan = { ...plan, approved: true, approvedAt: Date.now() };
    call.plan = session.plan;
    const toolMessage = {
      id: uid('msg_'),
      role: 'tool',
      toolCallId: call.id,
      name: 'update_plan',
      content: `Plan approved. Approved domains: ${[
        ...state.approvedDomains
      ].join(', ')}. You may now act on those domains.`,
      isError: false,
      images: [],
      createdAt: Date.now()
    };
    session.messages.push(toolMessage);
    return toolMessage;
  }

  call.plan = { ...plan, approved: state.planApproved };
  session.plan = call.plan;
  const toolMessage = {
    id: uid('msg_'),
    role: 'tool',
    toolCallId: call.id,
    name: 'update_plan',
    content: state.planApproved
      ? 'Plan updated.'
      : 'Plan shown to the user. Continue if no approval is required in this mode.',
    isError: false,
    images: [],
    createdAt: Date.now()
  };
  session.messages.push(toolMessage);
  return toolMessage;
}

function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function fitMessages(messages, settings) {
  const maxMessages = Math.max(8, settings.agent.maxHistoryMessages || 80);
  const maxChars = Math.max(8000, settings.agent.maxContextChars || 120000);
  const keepImages = Math.max(0, settings.agent.keepScreenshots ?? 2);

  const units = [];
  let current = null;
  for (const message of messages || []) {
    if (!message || !message.role) continue;
    if (message.role === 'assistant') {
      current = { messages: [message] };
      units.push(current);
      continue;
    }
    if (message.role === 'tool') {
      if (!current) {
        continue;
      }
      current.messages.push(message);
      continue;
    }
    current = { messages: [message] };
    units.push(current);
  }

  const selected = [];
  let chars = 0;
  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i];
    const size = unit.messages.reduce((sum, message) => {
      return (
        sum +
        String(message.content || '').length +
        JSON.stringify(message.toolCalls || []).length +
        40
      );
    }, 0);
    if (
      selected.length > 0 &&
      (chars + size > maxChars || selected.length >= maxMessages)
    ) {
      break;
    }
    selected.unshift(unit);
    chars += size;
  }
  if (!selected.length) selected.push(...units.slice(-1));

  const out = [];
  for (const unit of selected) {
    for (const message of unit.messages) {
      if (message.role === 'assistant') {
        if (!message.content?.trim() && !message.toolCalls?.length) continue;
        out.push({
          role: 'assistant',
          content: message.content || '',
          toolCalls: (message.toolCalls || []).map((call) => ({
            id: call.id,
            name: call.name,
            input: call.input || {}
          })),
          createdAt: message.createdAt
        });
      } else if (message.role === 'tool') {
        if (!message.toolCallId) continue;
        out.push({
          role: 'tool',
          toolCallId: message.toolCallId,
          name: message.name || '',
          content: message.content || '',
          isError: !!message.isError,
          images: message.images || []
        });
      } else {
        out.push({
          role: 'user',
          content: message.content || '',
          images: message.images || []
        });
      }
    }
  }

  // Keep only the most recent images so old screenshots do not dominate.
  let seenImages = 0;
  for (let i = out.length - 1; i >= 0; i--) {
    const message = out[i];
    if (!message.images?.length) continue;
    const allowed = Math.max(0, keepImages - seenImages);
    seenImages += message.images.length;
    if (allowed <= 0) {
      message.images = [];
    } else if (message.images.length > allowed) {
      message.images = message.images.slice(-allowed);
    }
  }
  return out;
}

export function estimateContextTokens(session, settings) {
  const messages = fitMessages(session.messages || [], settings);
  let chars = 0;
  for (const message of messages) {
    chars += String(message.content || '').length;
    chars += JSON.stringify(message.toolCalls || []).length;
    for (const image of message.images || []) {
      chars += Math.ceil((image.length || 0) / 4);
    }
  }
  return { tokens: Math.ceil(chars / 4), chars };
}

function mergeUsage(a, b) {
  const left = a || {};
  const right = b || {};
  return {
    input_tokens: (left.input_tokens || 0) + (right.input_tokens || 0),
    output_tokens: (left.output_tokens || 0) + (right.output_tokens || 0),
    cache_read_input_tokens:
      (left.cache_read_input_tokens || 0) +
      (right.cache_read_input_tokens || 0),
    cache_creation_input_tokens:
      (left.cache_creation_input_tokens || 0) +
      (right.cache_creation_input_tokens || 0)
  };
}

function emptyUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0
  };
}

function platformName() {
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return 'macOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Chrome';
}
