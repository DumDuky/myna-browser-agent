/** Permission decisions. Pure functions, shared by background and UI. */

import { PERMISSION_MODES, TOOL_KIND } from './constants.js';
import { hostOf } from './util.js';

const SENSITIVE_WORDS_RE =
  /(bank|banking|chase|wellsfargo|bankofamerica|citi|capitalone|usbank|pnc|hsbc|barclays|revolut|monzo|paypal|venmo|cashapp|stripe|square|coinbase|binance|kraken|robinhood|fidelity|schwab|vanguard)/i;

export function normalizeHost(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const host = raw.includes('://')
    ? hostOf(raw)
    : raw.replace(/\/.*$/, '');
  return host.replace(/^www\./, '');
}

export function isSensitiveHost(host) {
  const clean = normalizeHost(host);
  if (!clean) return false;
  if (/(^|\.)gov(\.[a-z]{2,})?$/i.test(clean)) return true;
  return SENSITIVE_WORDS_RE.test(clean);
}

export function ruleForHost(rules, host) {
  const clean = normalizeHost(host);
  if (!clean || !rules) return null;
  const normalized = {};
  for (const [key, value] of Object.entries(rules)) {
    normalized[normalizeHost(key)] = value;
  }
  const candidates = [clean];
  const parts = clean.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    candidates.push(parts.slice(i).join('.'));
  }
  for (const candidate of candidates) {
    if (normalized[candidate]) {
      return { host: candidate, rule: normalized[candidate] };
    }
  }
  for (const [key, value] of Object.entries(normalized)) {
    if (key.startsWith('*.')) {
      const suffix = key.slice(1);
      if (clean.endsWith(suffix)) return { host: key, rule: value };
    }
  }
  return null;
}

/**
 * Decide whether a tool may run.
 *
 * @returns {{allowed:boolean, needsPrompt:boolean, denied:boolean, reason:string, rule:object|null}}
 */
export function checkPermission({
  settings,
  host,
  kind,
  toolName = '',
  mode = settings?.permissions?.mode || PERMISSION_MODES.ASK,
  approvedDomains = [],
  sessionRules = {}
}) {
  const cleanHost = normalizeHost(host);
  const rules = { ...(settings?.permissions?.rules || {}), ...sessionRules };
  const found = ruleForHost(rules, cleanHost);
  const rule = found?.rule || null;
  const approved = approvedDomains
    .map(normalizeHost)
    .some((item) => item && (cleanHost === item || cleanHost.endsWith(`.${item}`)));

  if (!cleanHost) {
    return decision(false, false, 'No web page is attached.');
  }

  if (kind === TOOL_KIND.META) return decision(true);

  if (kind === TOOL_KIND.READ) {
    if (mode === PERMISSION_MODES.READONLY || mode === PERMISSION_MODES.AUTO) {
      return rule?.read === 'block'
        ? decision(false, false, 'Reading this site is blocked by a site rule.')
        : decision(true);
    }
    if (rule?.read === 'block') {
      return decision(false, false, 'Reading this site is blocked by a site rule.');
    }
    if (rule?.read === 'allow' || approved) return decision(true);
    return decision(
      false,
      true,
      `Myna wants to read ${cleanHost}.`,
      { category: 'read' }
    );
  }

  // Action tools.
  if (mode === PERMISSION_MODES.READONLY) {
    return decision(
      false,
      false,
      'Myna is in Read only mode. Switch modes to allow actions.'
    );
  }
  if (rule?.act === 'block') {
    return decision(false, false, 'Actions are blocked on this site by a rule.');
  }
  if (mode === PERMISSION_MODES.AUTO) {
    if (rule?.act === 'allow') return decision(true);
    if (isSensitiveHost(cleanHost) && toolName !== 'update_plan') {
      return decision(
        false,
        true,
        `This looks like a sensitive site (${cleanHost}). Myna needs your approval for this action.`,
        { category: 'act', sensitive: true }
      );
    }
    return decision(true);
  }
  if (mode === PERMISSION_MODES.PLAN) {
    if (!approved) {
      return decision(
        false,
        false,
        `This action is outside the approved plan. Approve ${cleanHost} in a plan first.`
      );
    }
    return decision(true);
  }
  // Ask mode.
  if (rule?.act === 'allow' || approved) return decision(true);
  return decision(
    false,
    true,
    `Myna wants to act on ${cleanHost}.`,
    { category: 'act', sensitive: isSensitiveHost(cleanHost) }
  );
}

function decision(allowed, needsPrompt, reason = '', extra = {}) {
  return {
    allowed,
    needsPrompt,
    denied: !allowed && !needsPrompt,
    reason,
    ...extra
  };
}

export function permissionRequestText({ toolName, input, host, kind }) {
  const where = host || 'this page';
  if (toolName === 'web_fetch') {
    return `Myna wants to fetch ${input?.url || 'a URL'}.`;
  }
  if (toolName === 'web_search') {
    return `Myna wants to search the web for “${input?.query || ''}”.`;
  }
  if (kind === TOOL_KIND.READ) {
    return `Myna wants to read ${where}.`;
  }
  if (toolName === 'navigate') {
    return `Myna wants to open ${input?.url || 'a new page'}.`;
  }
  if (toolName === 'computer') {
    const action = input?.action || 'control the page';
    if (
      action === 'screenshot' ||
      action === 'wait' ||
      action === 'scroll' ||
      action === 'scroll_to' ||
      action === 'hover' ||
      action === 'zoom'
    ) {
      return `Myna wants to ${action === 'screenshot' ? 'take a screenshot' : action} on ${where}.`;
    }
    if (action === 'type') return `Myna wants to type on ${where}.`;
    if (action === 'key') return `Myna wants to press keys on ${where}.`;
    if (action === 'left_click_drag') return `Myna wants to drag on ${where}.`;
    return `Myna wants to click on ${where}.`;
  }
  if (toolName === 'form_input') {
    return `Myna wants to fill a field on ${where}.`;
  }
  if (toolName === 'file_upload') {
    return `Myna wants to attach files to a file input on ${where}.`;
  }
  if (toolName === 'gif_creator') {
    return `Myna wants to record or export a GIF on ${where}.`;
  }
  if (toolName === 'tabs_create') return 'Myna wants to open a new tab.';
  if (toolName === 'tabs_close') return 'Myna wants to close a tab.';
  if (toolName === 'javascript_tool') {
    return `Myna wants to run JavaScript on ${where}.`;
  }
  if (toolName === 'resize_window') return 'Myna wants to resize the browser window.';
  if (toolName === 'browser_batch') {
    return `Myna wants to run ${input?.actions?.length || 0} browser actions, starting on ${where}.`;
  }
  return `Myna wants to use ${toolName} on ${where}.`;
}

export function addSiteRule(settings, host, category, value) {
  const clean = normalizeHost(host);
  if (!clean) return settings;
  const rules = { ...(settings.permissions?.rules || {}) };
  const existing = { ...(rules[clean] || {}) };
  if (category === 'read' || category === 'both') existing.read = value;
  if (category === 'act' || category === 'both') existing.act = value;
  rules[clean] = existing;
  return {
    ...settings,
    permissions: { ...settings.permissions, rules }
  };
}

export function removeSiteRule(settings, host) {
  const clean = normalizeHost(host);
  const rules = { ...(settings.permissions?.rules || {}) };
  delete rules[clean];
  return {
    ...settings,
    permissions: { ...settings.permissions, rules }
  };
}

export function isDomainApproved(host, approvedDomains = []) {
  const clean = normalizeHost(host);
  return approvedDomains
    .map(normalizeHost)
    .some((item) => item && (clean === item || clean.endsWith(`.${item}`)));
}
