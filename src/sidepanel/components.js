/** Reusable DOM components for the side panel. */

import {
  PERMISSION_MODE_LABELS,
  PROVIDER_ORDER,
  PROVIDER_PRESETS
} from '../lib/constants.js';
import { renderMarkdown } from '../lib/markdown.js';
import {
  humanizeToolName,
  truncate
} from '../lib/util.js';
import { summarizeToolCall } from '../lib/tools-schema.js';
import { icon, iconMarkup } from './icons.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      el.innerHTML = value;
    } else if (key === 'text') {
      el.textContent = value;
    } else if (key === 'aria' && typeof value === 'object') {
      for (const [name, val] of Object.entries(value)) {
        el.setAttribute(`aria-${name}`, String(val));
      }
    } else if (value === true) {
      el.setAttribute(key, '');
    } else if (value === false) {
      el.removeAttribute(key);
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, ...children);
  return el;
}

export function append(parent, ...children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      parent.appendChild(document.createTextNode(String(child)));
    } else {
      parent.appendChild(child);
    }
  }
}

export function iconEl(name, className = '') {
  const span = document.createElement('span');
  span.className = className;
  span.setAttribute('data-icon', name);
  span.innerHTML = iconMarkup(name);
  span.setAttribute('aria-hidden', 'true');
  return span;
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export function renderMessage(message, ctx) {
  if (message.role === 'user') return renderUserMessage(message, ctx);
  if (message.role === 'assistant') return renderAssistantMessage(message, ctx);
  return null;
}

function renderUserMessage(message, ctx) {
  const images = (message.images || []).map((src) =>
    h('img', {
      class: 'message-image',
      src,
      alt: 'Attached image',
      loading: 'lazy',
      onclick: () => ctx.onImageClick?.(src)
    })
  );
  const display = visibleUserText(message);
  return h(
    'article',
    { class: 'message message-user', 'data-id': message.id },
    h(
      'div',
      { class: 'message-body' },
      images.length ? h('div', { class: 'message-image-grid' }, images) : null,
      h('div', { class: 'user-bubble' }, display),
      h(
        'div',
        { class: 'message-time' },
        new Date(message.createdAt || Date.now()).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        })
      )
    ),
    h('div', { class: 'avatar', 'aria-hidden': 'true', text: 'You' })
  );
}

function visibleUserText(message) {
  if (message.display) return message.display;
  let text = String(message.content || '');
  text = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<page_content>[\s\S]*?<\/page_content>/gi, '')
    .trim();
  return text || (message.imageCount ? 'Attached image' : '');
}

function renderAssistantMessage(message, ctx) {
  const toolResults = ctx.toolResults || new Map();
  const toolStack = h('div', { class: 'tool-stack' });
  for (const call of message.toolCalls || []) {
    const result = toolResults.get(call.id);
    if (call.name === 'update_plan' && call.plan) {
      toolStack.appendChild(
        renderPlanCard(call.plan, {
          interactive: ctx.pendingPlanCallId === call.id,
          onApprove: ctx.onPlanApprove,
          onDeny: ctx.onPlanDeny,
          approved: !!call.plan.approved,
          stopped: call.status === 'stopped'
        })
      );
      continue;
    }
    toolStack.appendChild(renderToolCard(call, result, ctx));
  }

  const content = h('div', {
    class: 'assistant-content',
    'aria-live': message.status === 'streaming' ? 'polite' : undefined
  });
  renderMarkdown(content, message.content || '', {
    streaming: message.status === 'streaming'
  });

  const head = h(
    'div',
    { class: 'assistant-head' },
    h('span', { class: 'assistant-name', text: 'Myna' }),
    h('span', {
      class: 'assistant-status',
      text:
        message.status === 'streaming'
          ? 'Thinking…'
          : message.status === 'tool_use'
            ? 'Using tools'
            : message.status === 'error'
              ? 'Error'
              : message.status === 'stopped'
                ? 'Stopped'
                : ctx.profile?.model || ''
    })
  );

  const reasoning =
    message.reasoning && ctx.showReasoning
      ? h(
          'details',
          { class: 'reasoning' },
          h('summary', { text: 'Reasoning' }),
          h('div', { class: 'reasoning-body', text: message.reasoning })
        )
      : null;

  const footer = h('div', { class: 'message-footer' });
  if (message.usage?.output_tokens) {
    footer.appendChild(
      h('span', {
        class: 'footer-chip',
        text: `${message.usage.output_tokens.toLocaleString()} out`
      })
    );
  }
  if (message.usage?.input_tokens) {
    footer.appendChild(
      h('span', {
        class: 'footer-chip',
        text: `${message.usage.input_tokens.toLocaleString()} in`
      })
    );
  }
  footer.appendChild(
    h(
      'button',
      {
        class: 'icon-action',
        type: 'button',
        title: 'Copy response',
        'aria-label': 'Copy response',
        onclick: () => {
          navigator.clipboard.writeText(message.content || '');
          ctx.toast?.('Copied');
        }
      },
      iconEl('copy')
    )
  );
  if (message.error) {
    footer.appendChild(
      h('button', {
        class: 'footer-chip',
        type: 'button',
        style: { color: 'var(--danger)', borderColor: 'var(--danger)' },
        text: 'Retry',
        onclick: () => ctx.onRetry?.(message)
      })
    );
  }

  return h(
    'article',
    { class: 'message message-assistant', 'data-id': message.id },
    h(
      'div',
      { class: 'avatar', 'aria-hidden': 'true', html: iconMarkup('bird') }
    ),
    h(
      'div',
      { class: 'message-body' },
      head,
      reasoning,
      message.content || message.status === 'streaming' ? content : null,
      message.toolCalls?.length ? toolStack : null,
      message.error
        ? h('div', {
            class: 'assistant-content',
            style: { color: 'var(--danger)' },
            text: message.error
          })
        : null,
      footer
    )
  );
}

function renderToolCard(call, result, ctx) {
  const status =
    call.status ||
    (result ? (result.isError ? 'error' : 'ok') : 'running');
  const summary = summarizeToolCall(call.name, call.input);
  const statusText =
    status === 'running'
      ? 'Running'
      : status === 'error'
        ? 'Failed'
        : status === 'stopped'
          ? 'Stopped'
          : 'Done';
  const body = h('div', { class: 'tool-body', hidden: status !== 'error' });
  if (call.input && Object.keys(call.input).length) {
    body.appendChild(
      h('pre', { class: 'tool-args', text: JSON.stringify(call.input, null, 2) })
    );
  }
  if (result?.content) {
    body.appendChild(h('pre', { class: 'tool-output', text: result.content }));
  }
  if (result?.data?.results?.length) {
    const list = h('ul', { class: 'batch-list' });
    for (const item of result.data.results) {
      list.appendChild(
        h(
          'li',
          { class: `batch-item${item.ok ? '' : ' is-error'}` },
          h('span', { class: 'dot' }),
          h(
            'span',
            {},
            h('strong', { text: `${humanizeToolName(item.name)}: ` }),
            item.ok
              ? truncate(item.output || 'ok', 300)
              : `ERROR — ${item.error || 'failed'}`
          )
        )
      );
    }
    body.appendChild(list);
  }
  for (const image of result?.displayImages || result?.images || []) {
    body.appendChild(
      h('img', {
        class: 'tool-image',
        src: image.dataUrl,
        alt: 'Tool screenshot',
        loading: 'lazy',
        onclick: () => ctx.onImageClick?.(image.dataUrl)
      })
    );
  }

  const head = h(
    'button',
    {
      class: 'tool-head',
      type: 'button',
      'aria-expanded': 'false',
      onclick: (event) => {
        const isHidden = body.hasAttribute('hidden');
        body.toggleAttribute('hidden', !isHidden);
        event.currentTarget.setAttribute('aria-expanded', String(isHidden));
      }
    },
    h(
      'span',
      { class: 'tool-icon' },
      iconEl(toolIcon(call.name, call.input))
    ),
    h(
      'span',
      { class: 'tool-summary' },
      h('span', { class: 'tool-name', text: summary }),
      h('span', {
        class: 'tool-sub',
        text: toolSubtitle(call, result)
      })
    ),
    h(
      'span',
      { class: `tool-status ${status === 'ok' ? 'is-ok' : status === 'error' ? 'is-error' : ''}` },
      status === 'running'
        ? h('span', { class: 'spinner' })
        : iconEl(status === 'error' ? 'alert' : 'check'),
      h('span', { text: statusText })
    )
  );
  const card = h('div', { class: 'tool-card' }, head);
  if (body.childElementCount) card.appendChild(body);
  return card;
}

function toolIcon(name, input) {
  if (name.startsWith('mcp__')) return 'server';
  if (name === 'computer') {
    const action = input?.action || '';
    if (action === 'screenshot' || action === 'zoom') return 'camera';
    if (action === 'type' || action === 'key') return 'keyboard';
    if (action === 'scroll' || action === 'scroll_to') return 'down';
    if (action === 'navigate') return 'navigate';
    return 'cursor';
  }
  return (
    {
      read_page: 'eye',
      get_page_text: 'page',
      find: 'search',
      form_input: 'form',
      file_upload: 'upload',
      navigate: 'navigate',
      web_fetch: 'download',
      web_search: 'search',
      tabs_context: 'tabs',
      tabs_create: 'plus',
      tabs_close: 'x',
      read_console_messages: 'terminal',
      read_network_requests: 'terminal',
      resize_window: 'columns',
      browser_batch: 'sparkles',
      gif_creator: 'camera',
      javascript_tool: 'code',
      update_plan: 'plan'
    }[name] || 'dots'
  );
}

function toolSubtitle(call, result) {
  if (call.status === 'running') return 'Working…';
  if (result?.isError) return truncate(result.content.replace(/^ERROR:\s*/, ''), 90);
  if (call.name === 'read_page') {
    const data = result?.data || {};
    return data.elementCount
      ? `${data.elementCount} elements · ${data.refCount || 0} refs${
          data.truncated ? ' · truncated' : ''
        }`
      : 'Page structure';
  }
  if (call.name === 'get_page_text') {
    return result?.data?.length
      ? `${result.data.length.toLocaleString()} characters`
      : 'Page text';
  }
  if (call.name === 'find') {
    return result?.data?.total
      ? `${result.data.total} match${result.data.total === 1 ? '' : 'es'}`
      : 'Search results';
  }
  if (call.name === 'web_fetch') {
    return result?.data?.length
      ? `${result.data.length.toLocaleString()} characters`
      : 'Fetched URL';
  }
  if (call.name === 'web_search') {
    return result?.data?.results?.length
      ? `${result.data.results.length} results`
      : 'Search results';
  }
  if (call.name === 'read_console_messages') {
    return `${result?.data?.messages?.length || 0} messages`;
  }
  if (call.name === 'file_upload') {
    return result?.data?.count
      ? `${result.data.count} file${result.data.count === 1 ? '' : 's'}`
      : 'Files attached';
  }
  if (call.name === 'gif_creator') {
    return result?.data?.frames
      ? `${result.data.frames} frames`
      : 'Recording';
  }
  if (call.name === 'read_network_requests') {
    return `${result?.data?.requests?.length || 0} requests`;
  }
  if (call.name === 'computer' && result?.data?.frame) {
    return `${result.data.frame.width}×${result.data.frame.height}`;
  }
  if (call.name === 'browser_batch' && result?.data?.results) {
    const total = result.data.results.length;
    const ok = result.data.results.filter((item) => item.ok).length;
    return `${ok}/${total} actions succeeded`;
  }
  return truncate(
    String(result?.content || '')
      .replace(/\s+/g, ' ')
      .replace(/^Done\.?\s*/, ''),
    90
  );
}

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

export function renderPlanCard(plan, options = {}) {
  const approved = options.approved || plan.approved;
  const domains = plan.domains || [];
  const steps = plan.approach || [];
  const actions = h('div', { class: 'plan-actions' });
  if (options.interactive) {
    actions.appendChild(
      h('button', {
        class: 'button button-primary button-small',
        type: 'button',
        text: 'Approve & run',
        onclick: () => options.onApprove?.()
      })
    );
    actions.appendChild(
      h('button', {
        class: 'button button-secondary button-small',
        type: 'button',
        text: 'Cancel',
        onclick: () => options.onDeny?.()
      })
    );
  } else if (approved) {
    actions.appendChild(
      h(
        'span',
        { class: 'domain-chip' },
        iconEl('check'),
        h('span', { text: 'Approved' })
      )
    );
  } else if (options.stopped) {
    actions.appendChild(
      h('span', {
        class: 'plan-note',
        text: 'Plan not approved.'
      })
    );
  }

  return h(
    'div',
    { class: 'plan-card' },
    h('div', { class: 'plan-kicker' }, iconEl('plan'), h('span', { text: 'Plan' })),
    h('h3', {
      class: 'plan-title',
      text: approved ? 'Approved plan' : 'Here’s what I’ll do'
    }),
    domains.length
      ? h(
          'div',
          { class: 'plan-domains' },
          domains.map((domain) =>
            h(
              'span',
              { class: 'domain-chip' },
              iconEl('globe'),
              h('span', { text: domain })
            )
          )
        )
      : null,
    steps.length
      ? h(
          'ol',
          { class: 'plan-steps' },
          steps.map((step) => h('li', { text: step }))
        )
      : h('p', { class: 'plan-note', text: 'No steps were provided.' }),
    actions,
    options.interactive
      ? h('p', {
          class: 'plan-note',
          text: 'Tools on these domains will be approved for this chat. You can still stop at any time.'
        })
      : null
  );
}

/* ------------------------------------------------------------------ */
/* Permission                                                          */
/* ------------------------------------------------------------------ */

export function renderPermissionCard(request, { onDecision } = {}) {
  const isRead = request.kind === 'read';
  const isDomain = request.category === 'domain';
  const isSimple = request.category === 'simple';
  const title = isRead
    ? 'Allow reading this page?'
    : isDomain
      ? 'Continue to another site?'
      : 'Allow this action?';
  const sub = request.summary || 'Myna needs your permission to continue.';
  const allowSiteLabel = isRead
    ? 'Always allow reading here'
    : 'Always allow on this site';
  return h(
    'div',
    { class: 'permission-card', role: 'group', 'aria-label': title },
    h(
      'div',
      { class: 'permission-top' },
      h(
        'span',
        { class: 'permission-icon' },
        iconEl(request.sensitive ? 'shield' : isRead ? 'eye' : 'cursor')
      ),
      h(
        'div',
        { class: 'permission-copy' },
        h('p', { class: 'permission-title', text: title }),
        h('p', { class: 'permission-sub', text: sub }),
        request.host
          ? h('p', {
              class: 'permission-sub',
              style: { marginTop: '2px', color: 'var(--faint)' },
              text: request.host
            })
          : null
      )
    ),
    h(
      'div',
      { class: 'permission-actions' },
      h('button', {
        class: 'button button-primary button-small',
        type: 'button',
        text: 'Allow once',
        onclick: () => onDecision?.('allow')
      }),
      !isSimple
        ? h('button', {
            class: 'button button-secondary button-small',
            type: 'button',
            text: allowSiteLabel,
            onclick: () => onDecision?.('allow_site')
          })
        : null,
      h('button', {
        class: 'button button-ghost button-small',
        type: 'button',
        text: 'Deny',
        onclick: () => onDecision?.('deny')
      })
    )
  );
}

/* ------------------------------------------------------------------ */
/* Empty state, setup, quick prompts                                   */
/* ------------------------------------------------------------------ */

export function renderEmptyState({
  profile,
  profileReady,
  tab,
  restricted,
  onQuickPrompt,
  onSetup,
  onAdvanced,
  onOpenSettings,
  onOpenTab,
  autoOpenNewTab,
  onToggleNewTab
}) {
  const wrap = h('div', { class: 'empty-state' });
  wrap.appendChild(
    h(
      'div',
      { class: 'empty-hero' },
      h(
        'div',
        { class: 'empty-kicker' },
        h('span', { class: 'brand-mark', html: iconMarkup('bird') }),
        h('span', { text: 'Your browser, with a brain' })
      ),
      h(
        'h1',
        { class: 'empty-title' },
        'What should we ',
        h('em', { text: 'do' }),
        '?'
      ),
      h('p', {
        class: 'empty-sub',
        text: restricted
          ? 'Chrome blocks extensions on this page. Myna can open a normal tab and work there instead.'
          : 'Myna can read the page, click, type, open tabs, and explain what it finds. You bring the model; Myna brings the hands.'
      })
    )
  );

  if (!profileReady && !restricted) {
    wrap.appendChild(renderSetupCard({ profile, onSetup, onAdvanced }));
    return wrap;
  }
  if (restricted) {
    wrap.appendChild(
      renderRestrictedNotice({
        url: tab?.url,
        onOpenTab,
        autoOpen: autoOpenNewTab,
        onToggleAuto: onToggleNewTab
      })
    );
    return wrap;
  }

  const prompts = [
    {
      icon: 'sparkles',
      title: 'Summarize this page',
      sub: 'The short version, without the noise.',
      prompt:
        'Summarize this page. Give me the main point, the key facts, and anything I should do next.'
    },
    {
      icon: 'search',
      title: 'Find something',
      sub: 'Search the page in plain language.',
      prompt:
        'Find the most important information on this page about '
    },
    {
      icon: 'form',
      title: 'Fill this form',
      sub: 'Myna asks before submitting.',
      prompt:
        'Look at the form on this page, tell me what it needs, and help me fill it in. Ask before submitting anything.'
    },
    {
      icon: 'terminal',
      title: 'Explain this error',
      sub: 'Console and network clues included.',
      prompt:
        'Explain what this error means and how to fix it. Check the console and network requests if they help.'
    }
  ];

  const grid = h('div', { class: 'quick-grid' });
  for (const item of prompts) {
    grid.appendChild(
      h(
        'button',
        {
          class: 'quick-card',
          type: 'button',
          onclick: () => onQuickPrompt?.(item.prompt)
        },
        h('span', { class: 'quick-icon' }, iconEl(item.icon)),
        h('span', { class: 'quick-title', text: item.title }),
        h('span', { class: 'quick-sub', text: item.sub })
      )
    );
  }
  wrap.appendChild(grid);
  if (profile && !profileReady) {
    wrap.appendChild(
      h(
        'p',
        { class: 'form-hint' },
        'Your provider needs an API key. ',
        h('button', {
          class: 'button button-ghost button-small',
          type: 'button',
          text: 'Open settings',
          onclick: onOpenSettings
        })
      )
    );
  }
  return wrap;
}

export function renderSetupCard({ profile, onSetup, onAdvanced }) {
  const initial = profile?.preset || 'anthropic';
  let presetKey = PROVIDER_PRESETS[initial] ? initial : 'anthropic';
  const providerSelect = h(
    'select',
    { id: 'setupProvider', 'aria-label': 'Provider' },
    PROVIDER_ORDER.map((key) =>
      h('option', {
        value: key,
        text: PROVIDER_PRESETS[key].label,
        selected: key === presetKey
      })
    )
  );
  const baseInput = h('input', {
    id: 'setupBaseUrl',
    type: 'url',
    placeholder: 'https://…',
    value: profile?.baseUrl || PROVIDER_PRESETS[presetKey].baseUrl
  });
  const modelInput = h('input', {
    id: 'setupModel',
    type: 'text',
    placeholder: 'model-id',
    value: profile?.model || PROVIDER_PRESETS[presetKey].model
  });
  const keyInput = h('input', {
    id: 'setupKey',
    type: 'password',
    placeholder: 'Paste your API key',
    autocomplete: 'off',
    spellcheck: 'false'
  });
  const keyRow = h(
    'div',
    { class: 'form-row' },
    h('label', { for: 'setupKey', text: 'API key' }),
    keyInput
  );
  const hint = h('p', {
    class: 'form-hint',
    text: PROVIDER_PRESETS[presetKey].hint || ''
  });
  const error = h('p', {
    class: 'form-hint',
    style: { color: 'var(--danger)' },
    hidden: true
  });

  const applyPreset = (key) => {
    presetKey = key;
    const preset = PROVIDER_PRESETS[key];
    baseInput.value = preset.baseUrl;
    modelInput.value = preset.model;
    keyRow.hidden = preset.authStyle === 'none';
    keyInput.value = '';
    hint.textContent =
      preset.hint ||
      'Any OpenAI-compatible endpoint works. Point the base URL at the API root.';
  };
  providerSelect.addEventListener('change', () => applyPreset(providerSelect.value));
  applyPreset(presetKey);

  const form = h(
    'form',
    {
      class: 'setup-card',
      onsubmit: (event) => {
        event.preventDefault();
        const preset = PROVIDER_PRESETS[presetKey];
        const key = keyInput.value.trim();
        if (preset.authStyle !== 'none' && !key) {
          error.hidden = false;
          error.textContent = 'Paste an API key, or choose a local provider.';
          keyInput.focus();
          return;
        }
        if (!modelInput.value.trim()) {
          error.hidden = false;
          error.textContent = 'Add a model ID.';
          modelInput.focus();
          return;
        }
        onSetup?.({
          profileId: profile?.id,
          preset: presetKey,
          type: preset.type,
          baseUrl: baseInput.value.trim() || preset.baseUrl,
          model: modelInput.value.trim(),
          apiKey: key,
          authStyle: preset.authStyle,
          supportsImages: preset.supportsImages,
          maxOutputTokens: preset.maxOutputTokens,
          contextWindow: preset.contextWindow,
          includeCacheControl: preset.includeCacheControl === true,
          headers: preset.headers || {},
          query: preset.query || '',
          sessionOnlyKey: false
        });
      }
    },
    h(
      'div',
      { class: 'setup-head' },
      h('span', { class: 'setup-mark' }, iconEl('key')),
      h(
        'div',
        {},
        h('h2', { class: 'setup-title', text: 'Bring your own model' }),
        h('p', {
          class: 'setup-copy',
          text: 'Myna has no backend. Your key goes straight from this browser to the provider you choose. Start with Anthropic, OpenAI, OpenRouter, or a local Ollama server.'
        })
      )
    ),
    h(
      'div',
      { class: 'form-row' },
      h('label', { for: 'setupProvider', text: 'Provider' }),
      providerSelect,
      hint
    ),
    keyRow,
    h(
      'div',
      { class: 'form-row' },
      h('label', { for: 'setupModel', text: 'Model' }),
      modelInput
    ),
    h(
      'div',
      { class: 'form-row' },
      h('label', { for: 'setupBaseUrl', text: 'Base URL' }),
      baseInput
    ),
    error,
    h(
      'div',
      { class: 'form-actions' },
      h('button', {
        class: 'button button-primary',
        type: 'submit',
        text: 'Save & start'
      }),
      h('button', {
        class: 'button button-ghost button-small',
        type: 'button',
        text: 'Advanced setup',
        onclick: onAdvanced
      })
    ),
    h('p', {
      class: 'form-hint',
      text: 'Keys are stored in Chrome local storage unless you switch to session-only keys in Settings.'
    })
  );
  return form;
}

export function renderRestrictedNotice({
  url,
  onOpenTab,
  autoOpen,
  onToggleAuto
}) {
  const card = h(
    'div',
    { class: 'setup-card' },
    h(
      'div',
      { class: 'setup-head' },
      h('span', { class: 'setup-mark' }, iconEl('shield')),
      h(
        'div',
        { class: 'setup-copy-wrap' },
        h('h2', { class: 'setup-title', text: 'Chrome keeps this page private' }),
        h('p', {
          class: 'setup-copy',
          text: 'Extensions cannot read browser-internal pages. Myna can open a normal tab and work there instead.'
        })
      )
    )
  );
  if (url) {
    card.appendChild(h('code', { class: 'setup-url', text: url }));
  }
  card.appendChild(
    h(
      'div',
      { class: 'setup-actions' },
      h('button', {
        class: 'button button-primary',
        type: 'button',
        text: 'Open a normal tab',
        onclick: () => onOpenTab?.()
      })
    )
  );
  if (onToggleAuto) {
    card.appendChild(
      h(
        'label',
        { class: 'check-line setup-check' },
        h('input', {
          type: 'checkbox',
          checked: autoOpen !== false,
          onchange: (event) => onToggleAuto(!!event.target.checked)
        }),
        h('span', {
          text: 'Do this automatically when I send on a protected page.'
        })
      )
    );
  }
  return card;
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function toast(message, type = 'info', root = document.getElementById('toastRoot')) {
  if (!root) return;
  const el = h('div', { class: `toast${type === 'error' ? ' is-error' : ''}`, text: message });
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 220);
  }, 2800);
}

export function openImageModal(src, root = document.getElementById('modalRoot')) {
  if (!root) return;
  const close = () => {
    root.hidden = true;
    root.textContent = '';
  };
  const modal = h(
    'div',
    { class: 'modal' },
    h('h2', { text: 'Screenshot' }),
    h('p', { text: 'This is the image frame Myna sees. Click coordinates refer to this image.' }),
    h('img', { class: 'modal-image', src, alt: 'Screenshot preview' }),
    h(
      'div',
      { class: 'modal-actions' },
      h('button', {
        class: 'button button-secondary',
        type: 'button',
        text: 'Close',
        onclick: close
      })
    )
  );
  root.textContent = '';
  root.appendChild(modal);
  root.hidden = false;
  root.onclick = (event) => {
    if (event.target === root) close();
  };
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') close();
    },
    { once: true }
  );
}

export function confirmModal({ title, body, confirmText = 'Confirm', danger = false }, root = document.getElementById('modalRoot')) {
  return new Promise((resolve) => {
    const close = (value) => {
      root.hidden = true;
      root.textContent = '';
      resolve(value);
    };
    const modal = h(
      'div',
      { class: 'modal' },
      h('h2', { text: title }),
      h('p', { text: body }),
      h(
        'div',
        { class: 'modal-actions' },
        h('button', {
          class: 'button button-secondary',
          type: 'button',
          text: 'Cancel',
          onclick: () => close(false)
        }),
        h('button', {
          class: `button ${danger ? 'button-danger' : 'button-primary'}`,
          type: 'button',
          text: confirmText,
          onclick: () => close(true)
        })
      )
    );
    root.textContent = '';
    root.appendChild(modal);
    root.hidden = false;
  });
}

export function permissionModeLabel(mode) {
  return PERMISSION_MODE_LABELS[mode] || mode;
}

export function modelLabel(profile) {
  if (!profile) return 'No model';
  const name = profile.name ? `${profile.name}` : 'Model';
  return `${name} · ${profile.model || 'no model'}`;
}
