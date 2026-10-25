/** Myna service worker: side panel, tabs, context menus, and tool bridge. */

import { STORAGE_KEYS } from '../lib/constants.js';
import { loadSettings } from '../lib/settings.js';
import { isHttpUrl, isRestrictedUrl } from '../lib/util.js';
import { executeTool } from './tool-executor.js';
import {
  clearBuffers,
  detach,
  detachAll,
  hasDebuggerPermission,
  startCapture
} from './cdp.js';
import { clearFrame } from './screenshots.js';
import { clearRecording } from './gif-recorder.js';
import {
  ensureGrouped,
  getActiveTab,
  getTab,
  getViewport,
  summarizeTabs
} from './tabs.js';
import {
  deleteTask,
  handleAlarm,
  nextRun,
  reconcileTasks,
  recordTaskResult,
  runTaskNow,
  updateTask
} from './scheduler.js';

const PANEL_PATH = 'src/sidepanel/index.html';

chrome.runtime.onInstalled.addListener(async () => {
  await configureSidePanel();
  await setupContextMenus();
  await chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => {});
  await reconcileTasks().catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  await configureSidePanel();
  await setupContextMenus();
  await reconcileTasks().catch(() => {});
});

configureSidePanel();

/**
 * The side panel is deliberately global: one panel, one chat, following the
 * active tab. Per-tab panel paths made every tab load a separate chat state.
 */
function configureSidePanel() {
  return chrome.sidePanel
    .setOptions({ path: PANEL_PATH, enabled: true })
    .catch(() => {});
}

chrome.alarms.onAlarm.addListener((alarm) => {
  handleAlarm(alarm).catch(() => {});
});

async function setupContextMenus() {
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: 'myna-ask-selection',
      title: 'Ask Myna about “%s”',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'myna-summarize',
      title: 'Summarize this page with Myna',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: 'myna-screenshot',
      title: 'Ask Myna about a screenshot',
      contexts: ['page']
    });
  } catch {
    /* menus are best-effort */
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  const tabId = tab.id;
  let text = '';
  if (info.menuItemId === 'myna-ask-selection') {
    text = `Explain this selection and why it matters:\n\n“${String(
      info.selectionText || ''
    ).slice(0, 4000)}”`;
  } else if (info.menuItemId === 'myna-summarize') {
    text =
      'Summarize this page. Give me the main point, the key facts, and anything I should do next.';
  } else if (info.menuItemId === 'myna-screenshot') {
    text =
      'Take a screenshot of this page, tell me what you see, and point out anything important or unusual.';
  } else {
    return;
  }
  queuePrompt(tabId, text);
  openPanel(tabId);
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  openPanel(tab.id);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-side-panel') return;
  const tab = await getActiveTab();
  if (tab?.id) openPanel(tab.id);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await getTab(tabId);
    chrome.runtime
      .sendMessage({
        type: 'myna.tab_activated',
        tabId,
        title: tab.title || '',
        url: tab.url || '',
        status: tab.status || ''
      })
      .catch(() => {});
  } catch {
    /* ignore */
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title && changeInfo.status !== 'complete') {
    return;
  }
  if (changeInfo.url) clearFrame(tabId);
  chrome.runtime
    .sendMessage({
      type: 'myna.tab_updated',
      tabId,
      title: tab.title || '',
      url: tab.url || '',
      status: tab.status || ''
    })
    .catch(() => {});
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  clearFrame(tabId);
  clearBuffers(tabId);
  clearRecording(tabId);
  await detach(tabId);
  chrome.runtime
    .sendMessage({ type: 'myna.tab_closed', tabId })
    .catch(() => {});
  try {
    const [active] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (active?.id) {
      chrome.runtime
        .sendMessage({
          type: 'myna.tab_activated',
          tabId: active.id,
          title: active.title || '',
          url: active.url || '',
          status: active.status || ''
        })
        .catch(() => {});
    }
  } catch {
    /* no active tab */
  }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  clearFrame(details.tabId);
});

chrome.windows.onRemoved.addListener(() => {
  detachAll().catch(() => {});
});

function openPanel(tabId) {
  // Global panel path: one chat follows the active tab.
  configureSidePanel();
  try {
    chrome.sidePanel.open({ tabId }).catch(() => {});
  } catch {
    /* the command will fail visibly in old browsers */
  }
}

function queuePrompt(tabId, text) {
  const payload = {
    tabId,
    text,
    createdAt: Date.now()
  };
  chrome.storage.local
    .set({ [STORAGE_KEYS.PENDING_PROMPT]: payload })
    .catch(() => {});
  chrome.runtime
    .sendMessage({ type: 'myna.pending_prompt', ...payload })
    .catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Message bridge                                                      */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;
  if (sender.id !== chrome.runtime.id) return false;
  if (!message.type.startsWith('myna.')) return false;

  const run = async () => {
    switch (message.type) {
      case 'myna.tool':
        return handleTool(message);
      case 'myna.get_context':
        return handleGetContext(message);
      case 'myna.ensure_group':
        return handleEnsureGroup(message);
      case 'myna.attach_agent':
        return handleAttach(message);
      case 'myna.detach_agent':
        if (message.tabId) await detach(message.tabId);
        return { ok: true };
      case 'myna.permissions_status':
        return { ok: true, debugger: await hasDebuggerPermission() };
      case 'myna.reconcile_tasks':
        return { ok: true, ...(await reconcileTasks()) };
      case 'myna.run_task':
        await runTaskNow(message.taskId);
        return { ok: true };
      case 'myna.update_task':
        return { ok: true, ...(await updateTask(message.taskId, message.patch || {})) };
      case 'myna.delete_task':
        return { ok: true, ...(await deleteTask(message.taskId)) };
      case 'myna.record_task_result':
        await recordTaskResult(message.taskId, message.result || {});
        return { ok: true };
      case 'myna.next_run':
        return { ok: true, when: nextRun(message.task) };
      case 'myna.request_domain_access':
        return handleDomainAccess(message);
      case 'myna.open_options':
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      case 'myna.clear_pending_prompt':
        await chrome.storage.local.remove(STORAGE_KEYS.PENDING_PROMPT);
        return { ok: true };
      default:
        return { ok: false, error: `Unknown message: ${message.type}` };
    }
  };

  run()
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    );
  return true;
});

async function handleTool(message) {
  const { name, input, context } = message;
  if (!name) return { ok: false, error: 'No tool name.' };
  const result = await executeTool({
    name,
    input: input || {},
    context: {
      tabId: context?.tabId,
      groupId: context?.groupId,
      mode: context?.mode,
      approvedDomains: context?.approvedDomains || [],
      files: Array.isArray(context?.files) ? context.files : [],
      skipDomainConfirm: !!context?.skipDomainConfirm,
      toolUseId: context?.toolUseId
    }
  });
  return { ok: true, result };
}

async function handleGetContext(message) {
  const tab = await getTab(message.tabId);
  const settings = await loadSettings();
  let viewport = null;
  let selection = '';
  try {
    viewport = await getViewport(message.tabId);
    selection = await chrome.scripting
      .executeScript({
        target: { tabId: message.tabId },
        func: () => {
          const sel = window.getSelection();
          return sel ? String(sel).slice(0, 4000) : '';
        }
      })
      .then((results) => results?.[0]?.result || '')
      .catch(() => '');
  } catch {
    viewport = null;
  }
  const tabs = await summarizeTabs({ allWindows: true });
  return {
    ok: true,
    tab: {
      id: tab.id,
      title: tab.title || '',
      url: tab.url || '',
      status: tab.status || '',
      groupId: tab.groupId ?? -1,
      windowId: tab.windowId,
      favIconUrl: tab.favIconUrl || '',
      restricted: isRestrictedUrl(tab.url)
    },
    viewport,
    selection,
    tabs,
    mode: settings.permissions.mode,
    debugger: await hasDebuggerPermission()
  };
}

async function handleEnsureGroup(message) {
  const settings = await loadSettings();
  if (!message.tabId) return { ok: false, error: 'No tab ID.' };
  if (!settings.agent.groupTabs) return { ok: true, groupId: null };
  try {
    const groupId = await ensureGrouped(
      message.tabId,
      message.groupId,
      true
    );
    return { ok: true, groupId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function handleAttach(message) {
  if (!message.tabId) return { ok: false, error: 'No tab ID.' };
  try {
    await startCapture(message.tabId);
    return { ok: true, debugger: true };
  } catch (error) {
    return {
      ok: false,
      debugger: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function handleDomainAccess(message) {
  if (!message.url) return { ok: false, error: 'No URL.' };
  return {
    ok: true,
    allowed: isHttpUrl(message.url),
    host: (() => {
      try {
        return new URL(message.url).hostname;
      } catch {
        return '';
      }
    })()
  };
}
