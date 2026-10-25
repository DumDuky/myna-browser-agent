/** Tab lifecycle, tab groups, and page-agent injection. */

import { isRestrictedUrl, sleep } from '../lib/util.js';

export async function getTab(tabId) {
  return chrome.tabs.get(Number(tabId));
}

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab || null;
}

export async function listTabs({ allWindows = false } = {}) {
  const query = allWindows ? {} : { currentWindow: true };
  const tabs = await chrome.tabs.query(query);
  return tabs
    .filter((tab) => tab.id && typeof tab.id === 'number')
    .sort((a, b) => {
      if (a.active) return -1;
      if (b.active) return 1;
      return (a.index || 0) - (b.index || 0);
    });
}

export async function summarizeTabs({ allWindows = false } = {}) {
  const tabs = await listTabs({ allWindows });
  return tabs.slice(0, 60).map((tab) => ({
    id: tab.id,
    title: tab.title || 'Untitled',
    url: tab.url || tab.pendingUrl || '',
    active: !!tab.active,
    pinned: !!tab.pinned,
    groupId: tab.groupId ?? -1,
    windowId: tab.windowId
  }));
}

export async function ensureGrouped(tabId, groupId, enabled = true) {
  if (!enabled) return groupId ?? null;
  const tab = await getTab(tabId);
  if (isRestrictedUrl(tab.url || tab.pendingUrl)) return groupId ?? null;
  if (groupId !== undefined && groupId !== null && groupId !== -1) {
    if (tab.groupId === groupId) return groupId;
    try {
      await chrome.tabs.group({ tabIds: [tabId], groupId });
      return groupId;
    } catch {
      /* group disappeared; create a new one */
    }
  }
  if (tab.groupId !== undefined && tab.groupId !== null && tab.groupId !== -1) {
    await styleGroup(tab.groupId);
    return tab.groupId;
  }
  const newGroupId = await chrome.tabs.group({ tabIds: [tabId] });
  await styleGroup(newGroupId);
  return newGroupId;
}

export async function addTabToGroup(tabId, groupId, enabled = true) {
  if (!enabled) return groupId ?? null;
  try {
    if (groupId !== undefined && groupId !== null && groupId !== -1) {
      await chrome.tabs.group({ tabIds: [tabId], groupId });
      return groupId;
    }
  } catch {
    /* fall through */
  }
  return ensureGrouped(tabId, null, enabled);
}

async function styleGroup(groupId) {
  try {
    await chrome.tabGroups.update(groupId, {
      title: 'Myna',
      color: 'yellow',
      collapsed: false
    });
  } catch {
    /* styling is best-effort */
  }
}

export async function getMainTabId(tabId) {
  try {
    const tab = await getTab(tabId);
    return tab.openerTabId || tab.id;
  } catch {
    return tabId;
  }
}

export async function waitForTabComplete(tabId, timeoutMs = 20000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      last = tab;
      if (tab.status === 'complete') {
        await sleep(250);
        return tab;
      }
    } catch {
      break;
    }
    await sleep(150);
  }
  return last;
}

export async function ensurePageAgent(tabId) {
  const tab = await getTab(tabId);
  const url = tab.url || tab.pendingUrl || '';
  if (isRestrictedUrl(url)) {
    throw new Error(
      `Myna cannot read ${url || 'this page'}. Chrome blocks extensions on browser-internal pages. Open a normal http(s) page and try again.`
    );
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: Number(tabId) },
      files: ['src/page/page-agent.js'],
      injectImmediately: true
    });
  } catch (error) {
    throw new Error(
      `Could not access this page: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const ready = await chrome.scripting.executeScript({
    target: { tabId: Number(tabId) },
    func: () => !!(window.__myna && window.__myna.version === 1)
  });
  if (!ready?.[0]?.result) {
    throw new Error('The page agent did not initialize on this page.');
  }
  return true;
}

export async function pageCall(tabId, method, args = []) {
  await ensurePageAgent(tabId);
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: Number(tabId) },
      func: (name, callArgs) => {
        if (!window.__myna || typeof window.__myna[name] !== 'function') {
          throw new Error(`Unknown page function: ${name}`);
        }
        return window.__myna[name](...callArgs);
      },
      args: [method, args]
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      /cannot access|frame|no tab|missing host permission/i.test(message)
        ? 'Myna lost access to this tab. Refresh the page or open a normal http(s) page.'
        : message
    );
  }
  return results?.[0]?.result;
}

export async function pageInfo(tabId) {
  return pageCall(tabId, 'pageInfo', []);
}

export async function getViewport(tabId) {
  try {
    return await pageCall(tabId, 'viewport', []);
  } catch {
    return null;
  }
}

export async function navigateTab(tabId, url) {
  const target = String(url || '').trim();
  const tab = await getTab(tabId);
  if (!target) throw new Error('No URL was provided.');
  if (/^(back|forward)$/i.test(target)) {
    if (/^back$/i.test(target)) {
      await chrome.tabs.goBack(tabId);
    } else {
      await chrome.tabs.goForward(tabId);
    }
    const next = await waitForTabComplete(tabId);
    return tabResult(tabId, next);
  }
  let normalized = target;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    normalized = `https://${normalized.replace(/^\/+/, '')}`;
  }
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`"${target}" is not a valid URL.`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(
      'Myna can only navigate to http(s) URLs. Browser-internal pages are blocked.'
    );
  }
  const updated = await chrome.tabs.update(tabId, { url: parsed.toString() });
  const done = await waitForTabComplete(tabId);
  return tabResult(tabId, done || updated);
}

function tabResult(tabId, tab) {
  return {
    tabId,
    title: tab?.title || '',
    url: tab?.url || tab?.pendingUrl || '',
    status: tab?.status || 'unknown'
  };
}

export async function createTab({
  url = 'about:blank',
  active = true,
  windowId,
  groupId,
  groupTabs = true
}) {
  let target = String(url || '').trim() || 'about:blank';
  if (target !== 'about:blank' && !/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    target = `https://${target.replace(/^\/+/, '')}`;
  }
  if (target !== 'about:blank' && !/^https?:/i.test(target)) {
    throw new Error('Myna can only open http(s) tabs.');
  }
  const tab = await chrome.tabs.create({
    url: target,
    active,
    windowId: windowId || undefined
  });
  if (!tab.id) throw new Error('Chrome did not return a tab ID.');
  let nextGroup = groupId ?? null;
  if (groupTabs && target !== 'about:blank') {
    nextGroup = await addTabToGroup(tab.id, groupId, true);
  }
  if (active) await chrome.tabs.update(tab.id, { active: true });
  return { ...tabResult(tab.id, tab), groupId: nextGroup };
}

export async function closeTab(tabId) {
  const tabs = await listTabs({ allWindows: true });
  if (tabs.length <= 1) {
    throw new Error('Refusing to close the last tab in the browser.');
  }
  await chrome.tabs.remove(tabId);
  return { closed: true, tabId };
}

export async function resizeWindow(tabId, width, height) {
  const tab = await getTab(tabId);
  await chrome.windows.update(tab.windowId, {
    width: Math.round(width),
    height: Math.round(height)
  });
  await sleep(200);
  return { width: Math.round(width), height: Math.round(height) };
}

export async function focusTab(tabId) {
  const tab = await getTab(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  return tab;
}

export async function tabContext(tabId, groupId) {
  const tabs = await summarizeTabs({ allWindows: false });
  const current = tabs.find((tab) => tab.id === Number(tabId));
  return {
    currentTabId: Number(tabId),
    currentTitle: current?.title || '',
    currentUrl: current?.url || '',
    groupId: groupId ?? current?.groupId ?? -1,
    availableTabs: tabs,
    tabCount: tabs.length
  };
}

export async function findNewTabs(beforeIds, windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.filter((tab) => tab.id && !beforeIds.has(tab.id));
}
