/** Myna side panel controller. */

import {
  STORAGE_KEYS
} from '../lib/constants.js';
import {
  createProfile,
  getActiveProfile,
  loadSettings,
  profileHasCredentials,
  saveSettings
} from '../lib/settings.js';
import { buildTurnContext } from '../lib/prompt.js';
import { renderMarkdown } from '../lib/markdown.js';
import { loadMcpTools, mcpResultToTool } from '../lib/mcp.js';
import {
  formatError,
  formatRelativeTime,
  hostOf,
  escapeTag,
  isRestrictedUrl
} from '../lib/util.js';
import {
  clearSessions,
  createSession,
  loadActiveSessionId,
  loadSessions,
  saveActiveSessionId,
  saveSessions,
  titleFromText,
  toolResultMap
} from './sessions.js';
import {
  estimateContextTokens,
  runAgent
} from './agent.js';
import {
  confirmModal,
  h,
  iconEl,
  modelLabel,
  openImageModal,
  renderEmptyState,
  renderMessage,
  renderPermissionCard,
  toast
} from './components.js';
import { initIcons } from './icons.js';

const $ = (selector) => document.querySelector(selector);

const state = {
  settings: null,
  profile: null,
  sessions: [],
  session: null,
  tabId: null,
  tab: null,
  tabs: [],
  groupId: null,
  viewport: null,
  selection: '',
  restricted: false,
  contextRequestId: 0,
  debuggerGranted: false,
  debuggerAsked: false,
  running: false,
  abortController: null,
  pendingImages: [],
  pendingFiles: [],
  pendingPage: '',
  pendingPlan: null,
  currentPermission: null,
  permissionQueue: [],
  streamingAssistantId: null,
  lastUserText: '',
  saveTimer: null,
  initialized: false
};

init().catch((error) => {
  console.error(error);
  document.body.textContent = `Myna failed to start: ${formatError(error)}`;
});

async function init() {
  initIcons();
  bindEvents();
  state.settings = await loadSettings();
  state.profile = getActiveProfile(state.settings);
  state.sessions = await loadSessions();
  const activeId = await loadActiveSessionId();
  state.session =
    state.sessions.find((session) => session.id === activeId) ||
    state.sessions[0] ||
    createSession();
  if (!state.sessions.some((session) => session.id === state.session.id)) {
    state.sessions.unshift(state.session);
  }
  // A side panel is not a tab, so this only honors ?tabId when the page is
  // opened as a normal tab (used by tests and debugging). Production always
  // follows the active tab.
  let requestedTabId = 0;
  try {
    const ownTab = await chrome.tabs.getCurrent();
    if (ownTab) {
      requestedTabId = Number(
        new URLSearchParams(location.search).get('tabId')
      );
    }
  } catch {
    requestedTabId = 0;
  }
  if (Number.isFinite(requestedTabId) && requestedTabId > 0) {
    try {
      const tab = await chrome.tabs.get(requestedTabId);
      state.tabId = tab.id;
    } catch {
      state.tabId = null;
    }
  }
  if (!state.tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id ?? null;
  }
  applyAppearance();
  await refreshContext();
  await consumePendingPrompt();
  renderAll();
  focusComposer();
  state.initialized = true;
  chrome.storage.onChanged.addListener(handleStorageChange);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);
  updateOnlineState();
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function bindEvents() {
  $('#sendButton').addEventListener('click', sendMessage);
  $('#stopButton').addEventListener('click', stopAgent);
  $('#newChatButton').addEventListener('click', newChat);
  $('#drawerNewChat').addEventListener('click', () => {
    closeHistory();
    newChat();
  });
  $('#settingsButton').addEventListener('click', openSettings);
  $('#modelPill').addEventListener('click', openModelPicker);
  $('#modeButton').addEventListener('click', (event) => {
    event.stopPropagation();
    toggleModeMenu();
  });
  $('#modeMenu').addEventListener('click', (event) => {
    const option = event.target.closest('.mode-option');
    if (option) selectMode(option.dataset.mode);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#modePicker')) closeModeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModeMenu();
  });
  $('#historyButton').addEventListener('click', openHistory);
  $('#closeHistoryButton').addEventListener('click', closeHistory);
  $('#drawerScrim').addEventListener('click', closeHistory);
  $('#clearAllButton').addEventListener('click', clearAllSessions);
  $('#contextBar').addEventListener('click', () => {
    followActiveTab();
  });
  $('#attachButton').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', handleFiles);
  $('#filesButton').addEventListener('click', () => $('#uploadFileInput').click());
  $('#uploadFileInput').addEventListener('change', handleUploadFiles);
  $('#pageButton').addEventListener('click', togglePageContext);
  $('#screenshotButton').addEventListener('click', attachScreenshot);
  $('#jumpButton').addEventListener('click', scrollToBottom);

  const input = $('#composerInput');
  input.addEventListener('input', () => {
    autoResize(input);
    updateSendState();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      if (event.metaKey || event.ctrlKey || state.settings.agent.enterToSend) {
        event.preventDefault();
        sendMessage();
      }
    }
  });
  $('#chat').addEventListener('scroll', updateJumpButton, { passive: true });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!$('#modalRoot').hidden) {
        closeModal();
        return;
      }
      if ($('#historyDrawer').classList.contains('is-open')) {
        closeHistory();
        return;
      }
      if (state.running) stopAgent();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      newChat();
    }
  });
}

function updateOnlineState() {
  $('#offlineBanner').hidden = navigator.onLine;
}

async function handleStorageChange(changes, area) {
  if (area !== 'local') return;
  if (changes[STORAGE_KEYS.SETTINGS]) {
    state.settings = await loadSettings();
    state.profile = getActiveProfile(state.settings);
    applyAppearance();
    renderAll();
  }
}

function handleRuntimeMessage(message, sender, sendResponse) {
  if (!message || typeof message.type !== 'string') return false;
  if (message.type === 'myna.permission_request') {
    if (
      message.tabId !== undefined &&
      state.tabId !== null &&
      Number(message.tabId) !== Number(state.tabId)
    ) {
      return false;
    }
    const request = {
      ...message,
      respond: (decision) => sendResponse({ decision })
    };
    if (state.currentPermission) state.permissionQueue.push(request);
    else showPermission(request);
    return true;
  }
  if (message.type === 'myna.permission_timeout') {
    if (state.currentPermission?.requestId === message.requestId) {
      state.currentPermission = null;
      renderPermission();
      if (state.permissionQueue.length) {
        showPermission(state.permissionQueue.shift());
      }
    }
    return false;
  }
  if (message.type === 'myna.tab_activated') {
    if (state.running && Number(message.tabId) !== Number(state.tabId)) {
      return false;
    }
    state.tabId = Number(message.tabId);
    state.tab = {
      ...(state.tab || {}),
      id: message.tabId,
      title: message.title || '',
      url: message.url || '',
      status: message.status || ''
    };
    state.restricted = isRestrictedUrl(message.url || '');
    state.selection = '';
    state.viewport = null;
    state.groupId = null;
    refreshContext();
    return false;
  }
  if (message.type === 'myna.tab_updated') {
    if (Number(message.tabId) === Number(state.tabId)) {
      state.tab = {
        ...(state.tab || { id: message.tabId }),
        id: message.tabId,
        title: message.title || state.tab?.title || '',
        url: message.url || state.tab?.url || '',
        status: message.status || state.tab?.status || ''
      };
      if (message.url) {
        state.restricted = isRestrictedUrl(message.url);
        state.selection = '';
      }
      renderContext();
      renderComposer();
      if (!state.session.messages.length) renderChat();
    }
    return false;
  }
  if (message.type === 'myna.tab_closed') {
    if (Number(message.tabId) === Number(state.tabId)) {
      followActiveTab();
    }
    return false;
  }
  if (message.type === 'myna.pending_prompt') {
    applyPendingPrompt(message.text);
    return false;
  }
  if (message.type === 'myna.restricted_tab') {
    if (Number(message.tabId) === Number(state.tabId)) {
      state.restricted = isRestrictedUrl(state.tab?.url || message.url || '');
      renderContext();
      renderComposer();
      if (!state.session.messages.length) renderChat();
    }
    return false;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

async function refreshContext() {
  if (!state.tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id ?? null;
  }
  if (!state.tabId) {
    state.tab = null;
    renderContext();
    return;
  }
  const requestId = ++state.contextRequestId;
  const tabId = state.tabId;
  try {
    const response = await sendBackground({
      type: 'myna.get_context',
      tabId
    });
    if (requestId !== state.contextRequestId || tabId !== state.tabId) return;
    if (!response?.ok) throw new Error(response?.error || 'Context failed');
    state.tab = response.tab;
    state.tabs = response.tabs || [];
    state.viewport = response.viewport || null;
    state.selection = response.selection || '';
    state.restricted = !!response.tab?.restricted;
    state.debuggerGranted = !!response.debugger;
    if (response.tab?.groupId !== undefined) state.groupId = response.tab.groupId;
  } catch (error) {
    if (requestId !== state.contextRequestId || tabId !== state.tabId) return;
    state.tab = null;
    state.tabs = [];
    state.restricted = false;
    toast(formatError(error), 'error');
  }
  renderContext();
  renderComposer();
  renderMeter();
  if (!state.session.messages.length) renderChat();
}

async function followActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      state.tabId = null;
      state.tab = null;
      state.restricted = false;
      renderAll();
      return;
    }
    state.tabId = tab.id;
    state.tab = {
      id: tab.id,
      title: tab.title || '',
      url: tab.url || '',
      status: tab.status || '',
      groupId: tab.groupId ?? -1,
      restricted: isRestrictedUrl(tab.url)
    };
    state.restricted = isRestrictedUrl(tab.url);
    state.selection = '';
    state.viewport = null;
    state.groupId = tab.groupId ?? null;
    await refreshContext();
    renderAll();
  } catch {
    /* ignore */
  }
}

function renderContext() {
  const tab = state.tab;
  const title = $('#tabTitle');
  const host = $('#tabHost');
  const status = $('#contextStatus');
  const favicon = $('#tabFavicon');
  const bar = $('#contextBar');
  if (!tab) {
    title.textContent = 'No page attached';
    host.textContent = 'Open a normal website to give Myna hands.';
    favicon.removeAttribute('src');
    favicon.classList.remove('is-loaded');
    status.classList.remove('is-restricted');
    bar.classList.add('is-disabled');
    bar.title = 'Follow the active tab';
    return;
  }
  bar.classList.remove('is-disabled');
  bar.title = state.restricted
    ? 'Chrome-protected page — follow the active tab'
    : 'Follow the active tab';
  title.textContent = tab.title || 'Untitled page';
  host.textContent = state.restricted
    ? 'Chrome-protected page'
    : hostOf(tab.url) || tab.url;
  status.classList.toggle('is-restricted', state.restricted);
  favicon.onload = () => favicon.classList.add('is-loaded');
  favicon.onerror = () => favicon.classList.remove('is-loaded');
  if (tab.favIconUrl) {
    favicon.src = tab.favIconUrl;
  } else {
    favicon.removeAttribute('src');
    favicon.classList.remove('is-loaded');
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function applyAppearance() {
  const theme = state.settings?.ui?.theme || 'system';
  const density = state.settings?.ui?.density || 'comfortable';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.density = density;
}

function renderAll() {
  if (!state.settings || !state.session) return;
  applyAppearance();
  renderContext();
  renderMode();
  renderModel();
  renderChat();
  renderComposer();
  renderAttachments();
  renderPermission();
  renderMeter();
  renderHistory();
}

function renderChat() {
  const chat = $('#chat');
  const atBottom = isNearBottom(chat);
  chat.textContent = '';
  if (!state.session.messages.length) {
    chat.appendChild(
      renderEmptyState({
        profile: state.profile,
        profileReady: profileHasCredentials(state.profile),
        tab: state.tab,
        restricted: state.restricted,
        onQuickPrompt: (prompt) => {
          $('#composerInput').value = prompt;
          autoResize($('#composerInput'));
          updateSendState();
          focusComposer();
        },
        onSetup: handleSetup,
        onAdvanced: openSettings,
        onOpenSettings: openSettings,
        onOpenTab: openNewTabForMyna,
        autoOpenNewTab: state.settings.agent.openNewTabOnRestricted !== false,
        onToggleNewTab: async (checked) => {
          state.settings.agent.openNewTabOnRestricted = checked;
          state.settings = await saveSettings(state.settings);
          renderChat();
          toast(checked ? 'New tab on protected pages enabled' : 'New tab on protected pages disabled');
        }
      })
    );
  } else {
    const inner = h('div', { class: 'chat-inner' });
    const results = toolResultMap(state.session);
    const ctx = {
      profile: state.profile,
      toolResults: results,
      showReasoning: !!state.settings.agent.showReasoning,
      pendingPlanCallId: state.pendingPlan?.callId || null,
      onImageClick: (src) => openImageModal(src),
      onPlanApprove: () => decidePlan(true),
      onPlanDeny: () => decidePlan(false),
      onRetry: retryFromMessage,
      toast: (message) => toast(message)
    };
    for (const message of state.session.messages) {
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      const node = renderMessage(message, ctx);
      if (node) inner.appendChild(node);
    }
    chat.appendChild(inner);
  }
  if (!state.session.messages.length) {
    chat.scrollTop = 0;
    $('#jumpButton').hidden = true;
  } else if (atBottom) {
    requestAnimationFrame(scrollToBottom);
  } else {
    updateJumpButton();
  }
  const pendingPlanEl = chat.querySelector('.plan-card');
  if (state.pendingPlan && pendingPlanEl) {
    requestAnimationFrame(() =>
      pendingPlanEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
    );
  }
}

function updateStreamingMessage(message) {
  try {
    const chat = $('#chat');
    let content = chat.querySelector(
      `.message[data-id="${cssEscape(message.id)}"] .assistant-content`
    );
    if (!content) {
      renderChat();
      return;
    }
    renderMarkdown(content, message.content || '', { streaming: true });
    const status = chat.querySelector(
      `.message[data-id="${cssEscape(message.id)}"] .assistant-status`
    );
    if (status) status.textContent = 'Thinking…';
    if (isNearBottom(chat)) scrollToBottom();
  } catch (error) {
    console.warn('Myna streaming render failed', error);
  }
}

function renderMode() {
  const mode = state.settings.permissions.mode;
  const labels = {
    ask: 'Ask first',
    auto: 'Auto-run',
    plan: 'Plan first',
    readonly: 'Read only'
  };
  const titles = {
    ask: 'Ask before reading new sites or taking actions',
    auto: 'Act without prompting on approved sites',
    plan: 'Propose a plan and domains first',
    readonly: 'Read pages but never act'
  };
  const picker = $('#modePicker');
  if (picker) picker.dataset.mode = mode;
  $('#modeLabel').textContent = labels[mode] || 'Ask first';
  $('#modeButton').title = titles[mode] || 'Permission mode';
  for (const option of document.querySelectorAll('#modeMenu .mode-option')) {
    option.setAttribute(
      'aria-selected',
      option.dataset.mode === mode ? 'true' : 'false'
    );
  }
}

function toggleModeMenu(force) {
  const menu = $('#modeMenu');
  if (!menu) return;
  const open = force === undefined ? menu.hidden : !!force;
  menu.hidden = !open;
  $('#modeButton').setAttribute('aria-expanded', String(open));
}

function closeModeMenu() {
  toggleModeMenu(false);
}

function selectMode(mode) {
  if (!mode) return;
  state.settings.permissions.mode = mode;
  persistSettings();
  closeModeMenu();
  renderAll();
}

function renderModel() {
  const label = $('#modelLabel');
  const dot = document.querySelector('.model-dot');
  if (!state.profile) {
    label.textContent = 'No model';
    dot?.classList.add('is-offline');
    return;
  }
  label.textContent = `${state.profile.model || 'No model'}`;
  label.parentElement.title = modelLabel(state.profile);
  dot?.classList.toggle('is-offline', !profileHasCredentials(state.profile));
}

function renderComposer() {
  const input = $('#composerInput');
  const ready = profileHasCredentials(state.profile);
  input.placeholder = state.restricted
    ? state.settings.agent.openNewTabOnRestricted !== false
      ? 'Send to open a normal tab and use Myna…'
      : 'Open a normal website to use Myna…'
    : ready
      ? 'Ask Myna to do something on this page…'
      : 'Connect a provider to start…';
  $('#sendButton').hidden = state.running;
  $('#stopButton').hidden = !state.running;
  $('.composer-shell').classList.toggle('is-running', state.running);
  $('#pageButton').classList.toggle('is-active', !!state.pendingPage);
  updateSendState();
}

function updateSendState() {
  const input = $('#composerInput');
  const hasText = !!input.value.trim();
  const hasAttachments =
    state.pendingImages.length > 0 ||
    state.pendingFiles.length > 0 ||
    !!state.pendingPage;
  $('#sendButton').disabled = state.running || (!hasText && !hasAttachments);
}

function renderAttachments() {
  const strip = $('#attachmentStrip');
  strip.textContent = '';
  const items = [];
  if (state.pendingPage) {
    items.push(
      h(
        'div',
        { class: 'attachment-chip', style: { width: 'auto', padding: '0 8px' } },
        h(
          'span',
          { style: { display: 'flex', alignItems: 'center', gap: '4px', height: '100%', fontSize: '10px' } },
          iconEl('page'),
          h('span', { text: `Page text · ${state.pendingPage.length.toLocaleString()} chars` })
        ),
        h('button', {
          type: 'button',
          text: '×',
          'aria-label': 'Remove page text',
          onclick: () => {
            state.pendingPage = '';
            renderAttachments();
            renderComposer();
          }
        })
      )
    );
  }
  for (const image of state.pendingImages) {
    items.push(
      h(
        'div',
        { class: 'attachment-chip', title: image.name || 'Attached image' },
        h('img', { src: image.dataUrl, alt: image.name || 'Attached image' }),
        h('button', {
          type: 'button',
          text: '×',
          'aria-label': 'Remove image',
          onclick: () => {
            state.pendingImages = state.pendingImages.filter(
              (item) => item.id !== image.id
            );
            renderAttachments();
            renderComposer();
          }
        })
      )
    );
  }
  for (const file of state.pendingFiles) {
    items.push(
      h(
        'div',
        { class: 'attachment-chip', style: { width: 'auto', padding: '0 8px' }, title: file.name },
        h(
          'span',
          { style: { display: 'flex', alignItems: 'center', gap: '4px', height: '100%', fontSize: '10px' } },
          iconEl('upload'),
          h('span', { text: `${file.name} · ${Math.ceil(file.size / 1024)} KB` })
        ),
        h('button', {
          type: 'button',
          text: '×',
          'aria-label': 'Remove file',
          onclick: () => {
            state.pendingFiles = state.pendingFiles.filter(
              (item) => item.id !== file.id
            );
            renderAttachments();
            renderComposer();
          }
        })
      )
    );
  }
  strip.hidden = items.length === 0;
  for (const item of items) strip.appendChild(item);
}

function renderPermission() {
  const slot = $('#permissionSlot');
  slot.textContent = '';
  if (!state.currentPermission) {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  slot.appendChild(
    renderPermissionCard(state.currentPermission, {
      onDecision: (decision) => resolvePermission(decision)
    })
  );
  requestAnimationFrame(() => {
    slot.querySelector('button')?.focus({ preventScroll: true });
    slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function renderMeter() {
  const meter = $('#contextMeter');
  if (!state.session) {
    meter.textContent = '';
    return;
  }
  const { tokens } = estimateContextTokens(state.session, state.settings);
  const windowSize = state.profile?.contextWindow || 128000;
  const percent = Math.min(999, Math.round((tokens / windowSize) * 100));
  meter.textContent = `~${formatTokens(tokens)} / ${formatTokens(windowSize)}`;
  meter.title = `${percent}% of the model's context window (rough estimate). Older messages and images are trimmed automatically.`;
  meter.style.color = percent > 85 ? 'var(--danger)' : '';
}

function renderHistory() {
  const list = $('#historyList');
  list.textContent = '';
  const sessions = [...state.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!sessions.length) {
    list.appendChild(
      h('p', { class: 'form-hint', text: 'No chats yet. Start one below.' })
    );
    return;
  }
  for (const session of sessions) {
    const item = h(
      'div',
      {
        class: `history-item${session.id === state.session.id ? ' is-active' : ''}`
      },
      h(
        'button',
        {
          class: 'history-copy',
          type: 'button',
          style: { border: '0', background: 'transparent', padding: '0', textAlign: 'left' },
          onclick: () => loadSession(session)
        },
        h('div', {
          class: 'history-title',
          text: session.title || 'New chat'
        }),
        h('div', {
          class: 'history-meta',
          text: `${formatRelativeTime(session.updatedAt)} · ${countMessages(
            session
          )} messages`
        })
      ),
      h(
        'button',
        {
          class: 'history-delete',
          type: 'button',
          'aria-label': 'Delete chat',
          onclick: (event) => {
            event.stopPropagation();
            deleteSession(session);
          }
        },
        iconEl('trash')
      )
    );
    list.appendChild(item);
  }
}

/* ------------------------------------------------------------------ */
/* Restricted pages and new tabs                                       */
/* ------------------------------------------------------------------ */

function safeStartUrl() {
  const raw = String(state.settings.agent.newTabUrl || '').trim();
  const candidate = /^https?:\/\//i.test(raw)
    ? raw
    : `https://${raw || 'www.google.com'}`;
  try {
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol)) return 'https://www.google.com';
    return url.toString();
  } catch {
    return 'https://www.google.com';
  }
}

async function waitForTabReady(tabId, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return tab;
      }
    } catch {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

async function openNewTabForMyna() {
  const url = safeStartUrl();
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    if (!tab.id) throw new Error('Chrome did not return a tab.');
    state.tabId = tab.id;
    state.tab = {
      id: tab.id,
      title: tab.title || '',
      url,
      status: 'loading',
      restricted: false
    };
    state.restricted = false;
    state.groupId = null;
    state.selection = '';
    state.viewport = null;
    state.pendingPage = '';
    renderAll();
    await waitForTabReady(tab.id);
    await refreshContext();
    return tab;
  } catch (error) {
    toast(`Could not open a tab: ${formatError(error)}`, 'error');
    return null;
  }
}

async function sendMessage() {
  if (state.running) {
    stopAgent();
    return;
  }
  const input = $('#composerInput');
  const text = input.value.trim();
  if (
    !text &&
    !state.pendingImages.length &&
    !state.pendingFiles.length &&
    !state.pendingPage
  ) {
    return;
  }
  if (!profileHasCredentials(state.profile)) {
    toast('Connect a provider first.', 'error');
    renderAll();
    return;
  }
  if (state.restricted) {
    if (state.settings.agent.openNewTabOnRestricted === false) {
      toast(
        'Chrome blocks Myna on this page. Open a normal tab, or enable “Open a new tab on protected pages” in Settings.',
        'error'
      );
      return;
    }
    const opened = await openNewTabForMyna();
    if (!opened) return;
  }

  state.lastUserText = text;
  let context = '';
  try {
    context = state.settings.agent.includePageContext
      ? buildTurnContext({
          tab: state.tab,
          tabs: state.tabs,
          mode: state.settings.permissions.mode,
          selectedText: state.selection,
          viewport: state.viewport,
          includeSelectedText: state.settings.agent.includeSelectedText
        })
      : '';
  } catch {
    context = '';
  }
  let content = context ? `${context}\n\n${text}` : text;
  if (state.pendingFiles.length) {
    content += `\n\n<attached_files>\n${state.pendingFiles
      .map((file) => `- ${file.name} (${file.mime}, ${file.size} bytes)`)
      .join('\n')}\n</attached_files>\nThe user attached these files for page upload. Use file_upload with a file input ref when appropriate.`;
  }
  if (state.pendingPage) {
    content += `\n\n<page_content>\n${escapeTag(state.pendingPage)}\n</page_content>`;
  }
  const images = state.pendingImages.map((image) => image.dataUrl);
  const files = state.pendingFiles.map((file) => ({
    name: file.name,
    mime: file.mime,
    dataUrl: file.dataUrl
  }));
  const userMessage = {
    id: `msg_${crypto.randomUUID()}`,
    role: 'user',
    content,
    display:
      text ||
      (images.length
        ? 'Attached image'
        : files.length
          ? `Attached ${files.length} file${files.length === 1 ? '' : 's'}`
          : 'Attached page context'),
    images,
    fileCount: files.length,
    createdAt: Date.now()
  };
  state.session.messages.push(userMessage);
  if (!state.session.title || state.session.title === 'New chat') {
    state.session.title = titleFromText(text || 'Page task');
  }
  state.session.updatedAt = Date.now();
  state.pendingImages = [];
  state.pendingFiles = [];
  state.pendingPage = '';
  input.value = '';
  autoResize(input);
  state.running = true;
  state.abortController = new AbortController();
  state.streamingAssistantId = null;
  renderAll();
  saveSessionSoon();

  try {
    await ensureAgentReady();
  } catch (error) {
    toast(formatError(error), 'error');
  }

  let mcpTools = [];
  let mcpClients = new Map();
  if (Array.isArray(state.settings.mcpServers) && state.settings.mcpServers.length) {
    try {
      toast('Connecting to MCP servers…');
      const loaded = await loadMcpTools(state.settings.mcpServers);
      mcpTools = loaded.tools;
      mcpClients = loaded.clients;
      for (const error of loaded.errors) {
        toast(`MCP ${error.server}: ${error.error}`, 'error');
      }
      if (mcpTools.length) toast(`Connected to ${mcpTools.length} MCP tools`);
    } catch (error) {
      toast(`MCP setup failed: ${formatError(error)}`, 'error');
    }
  }

  const hooks = {
    onStep: () => {},
    onAssistantStart: (message) => {
      state.streamingAssistantId = message.id;
      renderChat();
    },
    onText: (message) => {
      updateStreamingMessage(message);
    },
    onReasoning: () => {},
    onAssistantDone: () => {
      state.streamingAssistantId = null;
      renderChat();
      saveSessionSoon();
    },
    onToolStart: () => {
      renderChat();
      saveSessionSoon();
    },
    onToolResult: (assistant, call, toolMessage) => {
      if (call.name === 'file_upload' && toolMessage && !toolMessage.isError) {
        toast('Files attached to the page');
      }
      if (toolMessage.tabContext?.currentTabId) {
        state.tabId = toolMessage.tabContext.currentTabId;
        if (toolMessage.tabContext.groupId !== undefined) {
          state.groupId = toolMessage.tabContext.groupId;
        }
        refreshContext();
      }
      if (toolMessage.data?.newTabId) {
        state.tabId = toolMessage.data.newTabId;
        refreshContext();
      }
      renderChat();
      saveSessionSoon();
    },
    onUsage: () => renderMeter(),
    requestPlan: (plan, assistant, call) =>
      new Promise((resolve) => {
        state.pendingPlan = { callId: call.id, plan, resolve };
        renderChat();
      }),
    onError: (error) => {
      toast(formatError(error), 'error');
    }
  };

  const result = await runAgent({
    session: state.session,
    profile: state.profile,
    settings: state.settings,
    tab: state.tab,
    tabs: state.tabs,
    viewport: state.viewport,
    mode: state.settings.permissions.mode,
    groupId: state.groupId,
    files,
    extraTools: mcpTools,
    executeMcpTool: (call, assistant) =>
      executeMcpToolCall(call, assistant, mcpTools, mcpClients),
    signal: state.abortController.signal,
    hooks
  });

  state.running = false;
  state.abortController = null;
  state.streamingAssistantId = null;
  state.pendingPlan = null;
  renderAll();
  saveSessionSoon();
  refreshContext();
  if (result?.stopped) toast('Stopped');
  else if (result?.error) toast(result.error, 'error');
  setTimeout(() => {
    if (state.running) return;
    sendBackground({ type: 'myna.detach_agent', tabId: state.tabId }).catch(
      () => {}
    );
  }, 900);
}

function stopAgent() {
  if (state.abortController) state.abortController.abort();
  if (state.currentPermission) resolvePermission('deny');
  for (const request of state.permissionQueue.splice(0)) {
    request.respond({ decision: 'deny' });
  }
  if (state.pendingPlan) {
    const plan = state.pendingPlan;
    state.pendingPlan = null;
    plan.resolve({ approved: false });
  }
  toast('Stopping…');
}

async function executeMcpToolCall(call, assistant, tools, clients) {
  const tool = tools.find((item) => item.name === call.name);
  const meta = tool?.mcp;
  if (!meta) {
    return { ok: false, error: `Unknown MCP tool: ${call.name}` };
  }
  if (state.settings.permissions.mode === 'readonly') {
    return { ok: false, error: 'Myna is in Read only mode.' };
  }
  if (state.settings.permissions.mode !== 'auto') {
    let host = '';
    try {
      host = new URL(meta.server.url).hostname;
    } catch {
      host = meta.server.name;
    }
    const decision = await askUiPermission({
      toolName: call.name,
      summary: `Myna wants to use the MCP tool “${meta.toolName}” from ${meta.server.name}.`,
      host
    });
    if (decision === 'deny') {
      return { ok: false, error: 'The user denied this MCP tool call.' };
    }
  }
  const client = clients.get(meta.serverId);
  if (!client) {
    return { ok: false, error: `MCP server ${meta.server.name} is not connected.` };
  }
  try {
    const result = await client.callTool(meta.toolName, call.input || {});
    return mcpResultToTool(result);
  } catch (error) {
    return {
      ok: false,
      error: `MCP ${meta.server.name}: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }
}

function askUiPermission({ toolName, summary, host }) {
  return new Promise((resolve) => {
    const request = {
      requestId: `mcp_${crypto.randomUUID()}`,
      kind: 'act',
      category: 'simple',
      toolName,
      summary,
      host,
      respond: (decision) => resolve(decision)
    };
    if (state.currentPermission) state.permissionQueue.push(request);
    else showPermission(request);
  });
}

async function ensureAgentReady() {
  if (state.settings.agent.groupTabs && state.tabId) {
    try {
      const response = await sendBackground({
        type: 'myna.ensure_group',
        tabId: state.tabId,
        groupId: state.groupId
      });
      if (response?.ok && response.groupId !== undefined) {
        state.groupId = response.groupId;
      }
    } catch {
      /* grouping is optional */
    }
  }
  if (!state.settings.agent.trustedInput) return;
  if (!state.debuggerGranted && !state.debuggerAsked) {
    state.debuggerAsked = true;
    try {
      state.debuggerGranted = await chrome.permissions.request({
        permissions: ['debugger']
      });
    } catch {
      state.debuggerGranted = false;
    }
    if (!state.debuggerGranted) {
      toast('Using standard page control. Enable trusted control in Settings for harder sites.');
      return;
    }
  }
  if (state.debuggerGranted && state.tabId) {
    const response = await sendBackground({
      type: 'myna.attach_agent',
      tabId: state.tabId
    });
    if (!response?.ok) {
      state.debuggerGranted = false;
      toast('Trusted browser control is unavailable. Using standard page control.', 'error');
    }
  }
}

async function handleSetup(data) {
  try {
    const overrides = { ...data };
    delete overrides.profileId;
    if (data.profileId) overrides.id = data.profileId;
    else delete overrides.id;
    delete overrides.name;
    const profile = createProfile(data.preset || 'custom', overrides);
    const profiles = state.settings.profiles.filter(
      (item) => item.id !== profile.id
    );
    profiles.push(profile);
    state.settings.profiles = profiles;
    state.settings.activeProfileId = profile.id;
    state.settings = await saveSettings(state.settings);
    state.profile = getActiveProfile(state.settings);
    toast('Provider saved');
    renderAll();
    refreshContext();
    focusComposer();
  } catch (error) {
    toast(formatError(error), 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Permissions and plans                                               */
/* ------------------------------------------------------------------ */

function showPermission(request) {
  state.currentPermission = request;
  renderPermission();
}

function resolvePermission(decision) {
  const request = state.currentPermission;
  if (!request) return;
  state.currentPermission = null;
  try {
    request.respond(decision);
  } catch {
    /* channel may already be closed */
  }
  renderPermission();
  if (state.permissionQueue.length) {
    const next = state.permissionQueue.shift();
    showPermission(next);
  }
}

function decidePlan(approved) {
  const pending = state.pendingPlan;
  if (!pending) return;
  state.pendingPlan = null;
  pending.resolve({
    approved,
    domains: approved ? pending.plan.domains || [] : []
  });
  renderChat();
}

function retryFromMessage() {
  const input = $('#composerInput');
  input.value = state.lastUserText || '';
  autoResize(input);
  updateSendState();
  focusComposer();
  toast('Edit your message and send again');
}

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

async function handleFiles(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    if (file.size > 5 * 1024 * 1024) {
      toast(`${file.name} is too large (max 5 MB).`, 'error');
      continue;
    }
    if (state.pendingImages.length >= 4) {
      toast('You can attach up to 4 images per message.', 'error');
      break;
    }
    const dataUrl = await readFile(file);
    state.pendingImages.push({
      id: `img_${crypto.randomUUID()}`,
      dataUrl,
      name: file.name
    });
  }
  renderAttachments();
  renderComposer();
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleUploadFiles(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) {
      toast(`${file.name} is too large (max 5 MB).`, 'error');
      continue;
    }
    if (state.pendingFiles.length >= 4) {
      toast('You can attach up to 4 files for upload.', 'error');
      break;
    }
    const dataUrl = await readFile(file);
    state.pendingFiles.push({
      id: `file_${crypto.randomUUID()}`,
      dataUrl,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size
    });
  }
  renderAttachments();
  renderComposer();
}

async function togglePageContext() {
  if (state.pendingPage) {
    state.pendingPage = '';
    renderAttachments();
    renderComposer();
    return;
  }
  toast('Reading the page…');
  try {
    const response = await sendBackground({
      type: 'myna.tool',
      name: 'get_page_text',
      input: { max_chars: 50000 },
      context: {
        tabId: state.tabId,
        groupId: state.groupId,
        mode: state.settings.permissions.mode,
        approvedDomains: state.session.approvedDomains || []
      }
    });
    const result = response?.result;
    if (!result?.ok) {
      toast(result?.error || 'Could not read this page.', 'error');
      return;
    }
    state.pendingPage = result.output;
    renderAttachments();
    renderComposer();
    toast(`Page text attached (${result.output.length.toLocaleString()} chars)`);
  } catch (error) {
    toast(formatError(error), 'error');
  }
}

async function attachScreenshot() {
  toast('Taking a screenshot…');
  try {
    const response = await sendBackground({
      type: 'myna.tool',
      name: 'computer',
      input: { action: 'screenshot' },
      context: {
        tabId: state.tabId,
        groupId: state.groupId,
        mode: state.settings.permissions.mode,
        approvedDomains: state.session.approvedDomains || []
      }
    });
    const result = response?.result;
    if (!result?.ok || !result.images?.[0]) {
      toast(result?.error || 'Could not take a screenshot.', 'error');
      return;
    }
    state.pendingImages.push({
      id: `img_${crypto.randomUUID()}`,
      dataUrl: result.images[0].dataUrl,
      name: 'Screenshot'
    });
    renderAttachments();
    renderComposer();
    toast('Screenshot attached');
    setTimeout(() => {
      if (!state.running) {
        sendBackground({ type: 'myna.detach_agent', tabId: state.tabId }).catch(
          () => {}
        );
      }
    }, 800);
  } catch (error) {
    toast(formatError(error), 'error');
  }
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

async function newChat() {
  if (state.running) stopAgent();
  await flushSession();
  state.session = createSession();
  state.sessions.unshift(state.session);
  state.pendingImages = [];
  state.pendingFiles = [];
  state.pendingPage = '';
  state.pendingPlan = null;
  saveActiveSessionId(state.session.id);
  saveSessionSoon();
  closeHistory();
  renderAll();
  focusComposer();
}

async function loadSession(session) {
  if (state.running) stopAgent();
  await flushSession();
  state.session = session;
  state.pendingPlan = null;
  saveActiveSessionId(session.id);
  closeHistory();
  await refreshContext();
  renderAll();
  scrollToBottom();
}

async function flushSession() {
  if (!state.session) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  state.session.updatedAt = Date.now();
  state.sessions = [
    state.session,
    ...state.sessions.filter((item) => item.id !== state.session.id)
  ].slice(0, 100);
  try {
    await saveSessions(state.sessions);
    await saveActiveSessionId(state.session.id);
  } catch {
    /* the next save will retry */
  }
}

async function deleteSession(session) {
  const ok = await confirmModal({
    title: 'Delete this chat?',
    body: `“${session.title || 'New chat'}” will be removed from this browser.`,
    confirmText: 'Delete',
    danger: true
  });
  if (!ok) return;
  if (session.id === state.session.id && state.running) stopAgent();
  state.sessions = state.sessions.filter((item) => item.id !== session.id);
  if (state.session.id === session.id) {
    state.session = createSession();
    state.sessions.unshift(state.session);
    saveActiveSessionId(state.session.id);
  }
  await saveSessions(state.sessions);
  renderHistory();
  renderAll();
}

async function clearAllSessions() {
  const ok = await confirmModal({
    title: 'Clear all chats?',
    body: 'This deletes every Myna chat stored in this browser. Your provider settings stay.',
    confirmText: 'Clear all',
    danger: true
  });
  if (!ok) return;
  if (state.running) stopAgent();
  await clearSessions();
  state.sessions = [];
  state.session = createSession();
  state.sessions.unshift(state.session);
  state.pendingImages = [];
  state.pendingFiles = [];
  state.pendingPage = '';
  state.pendingPlan = null;
  saveActiveSessionId(state.session.id);
  await saveSessions(state.sessions);
  closeHistory();
  renderAll();
}

function openHistory() {
  renderHistory();
  $('#historyDrawer').classList.add('is-open');
  $('#historyDrawer').setAttribute('aria-hidden', 'false');
  $('#drawerScrim').hidden = false;
}

function closeHistory() {
  $('#historyDrawer').classList.remove('is-open');
  $('#historyDrawer').setAttribute('aria-hidden', 'true');
  $('#drawerScrim').hidden = true;
}

/* ------------------------------------------------------------------ */
/* Model picker / settings                                             */
/* ------------------------------------------------------------------ */

function openModelPicker() {
  if (!state.settings.profiles.length) {
    openSettings();
    return;
  }
  const root = $('#modalRoot');
  const modal = h(
    'div',
    { class: 'modal' },
    h('h2', { text: 'Choose a model' }),
    h('p', { text: 'Each profile is a provider, base URL, and model. Add as many as you like.' }),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
      state.settings.profiles.map((profile) => {
        const active = profile.id === state.settings.activeProfileId;
        return h(
          'button',
          {
            type: 'button',
            class: `history-item${active ? ' is-active' : ''}`,
            style: { width: '100%', cursor: 'pointer' },
            onclick: async () => {
              state.settings.activeProfileId = profile.id;
              state.settings = await saveSettings(state.settings);
              state.profile = getActiveProfile(state.settings);
              closeModal();
              renderAll();
              refreshContext();
            }
          },
          h(
            'span',
            { class: 'history-copy' },
            h('div', { class: 'history-title', text: profile.name }),
            h('div', {
              class: 'history-meta',
              text: `${profile.model}${profile.authStyle === 'none' ? ' · no key' : ''}`
            })
          ),
          active ? iconEl('check') : null
        );
      })
    ),
    h(
      'div',
      { class: 'modal-actions' },
      h('button', {
        class: 'button button-secondary',
        type: 'button',
        text: 'Manage providers',
        onclick: () => {
          closeModal();
          openSettings();
        }
      }),
      h('button', {
        class: 'button button-ghost',
        type: 'button',
        text: 'Close',
        onclick: closeModal
      })
    )
  );
  root.textContent = '';
  root.appendChild(modal);
  root.hidden = false;
  root.onclick = (event) => {
    if (event.target === root) closeModal();
  };
}

function openSettings() {
  chrome.runtime.openOptionsPage().catch((error) => toast(formatError(error), 'error'));
}

function closeModal() {
  const root = $('#modalRoot');
  root.hidden = true;
  root.textContent = '';
  root.onclick = null;
}

/* ------------------------------------------------------------------ */
/* Prompt handoff / misc                                               */
/* ------------------------------------------------------------------ */

async function consumePendingPrompt() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.PENDING_PROMPT);
    const pending = stored[STORAGE_KEYS.PENDING_PROMPT];
    if (pending?.text && Date.now() - (pending.createdAt || 0) < 5 * 60_000) {
      if (pending.tabId && Number(pending.tabId) !== Number(state.tabId)) {
        try {
          const tab = await chrome.tabs.get(pending.tabId);
          state.tabId = tab.id;
          state.tab = {
            id: tab.id,
            title: tab.title || '',
            url: tab.url || '',
            status: tab.status || ''
          };
          state.restricted = isRestrictedUrl(tab.url);
          await refreshContext();
        } catch {
          /* the source tab is gone; keep the active tab */
        }
      }
      applyPendingPrompt(pending.text);
    }
    if (pending) await chrome.storage.local.remove(STORAGE_KEYS.PENDING_PROMPT);
  } catch {
    /* ignore */
  }
}

function applyPendingPrompt(text) {
  if (!text) return;
  const input = $('#composerInput');
  input.value = String(text);
  autoResize(input);
  updateSendState();
  focusComposer();
  try {
    chrome.storage.local.remove(STORAGE_KEYS.PENDING_PROMPT);
  } catch {
    /* ignore */
  }
}

function persistSettings() {
  saveSettings(state.settings)
    .then((normalized) => {
      state.settings = normalized;
      state.profile = getActiveProfile(normalized);
    })
    .catch((error) => toast(formatError(error), 'error'));
}

function saveSessionSoon() {
  if (!state.session) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    try {
      state.session.updatedAt = Date.now();
      state.sessions = [
        state.session,
        ...state.sessions.filter((item) => item.id !== state.session.id)
      ].slice(0, 100);
      await saveSessions(state.sessions);
      await saveActiveSessionId(state.session.id);
      renderHistory();
    } catch (error) {
      toast(`Could not save this chat: ${formatError(error)}`, 'error');
    }
  }, 450);
}

function sendBackground(message) {
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

function focusComposer() {
  const input = $('#composerInput');
  input.focus({ preventScroll: true });
}

function autoResize(input) {
  input.style.height = 'auto';
  input.style.height = `${Math.min(180, input.scrollHeight)}px`;
}

function isNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

function scrollToBottom() {
  const chat = $('#chat');
  chat.scrollTop = chat.scrollHeight;
  $('#jumpButton').hidden = true;
}

function updateJumpButton() {
  const chat = $('#chat');
  $('#jumpButton').hidden = isNearBottom(chat);
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}

function countMessages(session) {
  return (session.messages || []).filter(
    (message) => message.role === 'user' || message.role === 'assistant'
  ).length;
}

function cssEscape(value) {
  if (globalThis.CSS && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}


