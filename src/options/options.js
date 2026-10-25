/** Myna settings controller. */

import {
  AGENT_PRESETS,
  APPEARANCE_PRESETS,
  MODEL_PRESETS,
  PERMISSION_PRESETS,
  PROVIDER_ORDER,
  PROVIDER_PRESETS,
  STORAGE_KEYS
} from '../lib/constants.js';
import {
  getActiveProfile,
  loadSettings,
  normalizeProfile,
  saveSettings
} from '../lib/settings.js';
import { normalizeHost } from '../lib/permissions.js';
import { loadMcpTools } from '../lib/mcp.js';
import {
  fetchModels,
  testProfile
} from '../lib/providers/index.js';
import { formatError, formatBytes, uid } from '../lib/util.js';
import { initIcons } from '../sidepanel/icons.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  settings: null,
  editingId: null,
  dirty: false,
  debuggerGranted: false,
  sessions: []
};

init().catch((error) => {
  document.body.textContent = `Myna settings failed to load: ${formatError(error)}`;
});

async function init() {
  initIcons();
  state.settings = await loadSettings();
  await loadSessionsForStats();
  buildPresetOptions();
  bindNav();
  bindGlobal();
  bindProfileEditor();
  bindAgentForm();
  bindTasks();
  bindMcp();
  bindSkills();
  bindPermissions();
  bindData();
  bindAppearance();
  renderAll();
  const tab = new URLSearchParams(location.search).get('tab');
  if (tab) activateTab(tab);
  await refreshDebuggerStatus();
  if (!state.settings.profiles.length) openEditor(null);
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEYS.SETTINGS]) return;
    state.settings = await loadSettings();
    renderTasks();
  });
}

/* ------------------------------------------------------------------ */
/* Tabs and chrome                                                     */
/* ------------------------------------------------------------------ */

function buildPresetOptions() {
  const select = $('#presetSelect');
  select.textContent = '';
  for (const key of PROVIDER_ORDER) {
    select.appendChild(
      document.createElement('option')
    ).value = key;
    select.lastChild.textContent = PROVIDER_PRESETS[key].label;
  }
}

function bindNav() {
  for (const button of $$('.nav-item')) {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  }
}

function activateTab(name) {
  const known = $$('.panel').map((panel) => panel.id.replace('panel-', ''));
  if (!known.includes(name)) return;
  for (const button of $$('.nav-item')) {
    button.classList.toggle('is-active', button.dataset.tab === name);
  }
  for (const panel of $$('.panel')) {
    panel.hidden = panel.id !== `panel-${name}`;
    panel.classList.toggle('is-active', !panel.hidden);
  }
  const titles = {
    providers: ['Configuration', 'Providers'],
    agent: ['Behaviour', 'Agent'],
    scheduled: ['Automation', 'Scheduled'],
    mcp: ['Extensibility', 'MCP'],
    permissions: ['Safety', 'Permissions'],
    appearance: ['Look and feel', 'Appearance'],
    data: ['Local data', 'Data'],
    about: ['Myna', 'About']
  };
  $('#sectionEyebrow').textContent = titles[name]?.[0] || 'Configuration';
  $('#sectionTitle').textContent = titles[name]?.[1] || name;
  if (name === 'data') refreshStats();
}

function bindGlobal() {
  $('#saveButton').addEventListener('click', saveAll);
  $('#openPanelButton').addEventListener('click', openSidePanel);
  $('#versionLabel').textContent = `v${chrome.runtime.getManifest().version}`;
  $('#openReadmeButton').addEventListener('click', () =>
    chrome.tabs.create({ url: chrome.runtime.getURL('README.md') })
  );
  $('#openLimitsButton').addEventListener('click', () =>
    chrome.tabs.create({ url: chrome.runtime.getURL('docs/limitations.md') })
  );
  $('#openReButton').addEventListener('click', () =>
    chrome.tabs.create({
      url: chrome.runtime.getURL('docs/reverse-engineering.md')
    })
  );
  document.addEventListener('input', markDirty);
  document.addEventListener('change', markDirty);
}

function markDirty(event) {
  if (event?.target?.closest?.('#profileForm')) return;
  state.dirty = true;
  $('#saveState').textContent = 'Unsaved changes';
}

function openSidePanel() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) {
      toast('No active tab.', 'error');
      return;
    }
    const path = 'src/sidepanel/index.html';
    try {
      chrome.sidePanel
        .setOptions({ path, enabled: true })
        .catch(() => {});
      chrome.sidePanel
        .open({ tabId: tab.id })
        .catch((error) => toast(formatError(error), 'error'));
    } catch (error) {
      toast(formatError(error), 'error');
    }
  });
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function renderAll() {
  applyAppearance();
  renderProviderPresets();
  renderProfiles();
  renderAgentPresets();
  renderAgentForm();
  renderTasks();
  renderMcp();
  renderPermissions();
  renderPermissionPresets();
  renderAppearanceForm();
  renderAppearancePresets();
  renderDataStats();
}

function renderProviderPresets() {
  const grid = $('#providerPresetGrid');
  if (!grid) return;
  grid.textContent = '';
  for (const key of PROVIDER_ORDER) {
    const preset = PROVIDER_PRESETS[key];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'preset-card';
    card.innerHTML = `<span class="preset-name"></span><span class="preset-desc"></span>`;
    $('.preset-name', card).textContent = preset.label;
    $('.preset-desc', card).textContent =
      preset.hint || `${preset.type === 'anthropic' ? 'Anthropic Messages' : 'OpenAI-compatible'} · ${preset.model}`;
    card.addEventListener('click', () => openEditor(null, key));
    grid.appendChild(card);
  }
}

function renderAgentPresets() {
  const grid = $('#agentPresetGrid');
  if (!grid) return;
  grid.textContent = '';
  for (const [key, preset] of Object.entries(AGENT_PRESETS)) {
    const applied =
      state.settings.permissions.mode === preset.mode &&
      Number(state.settings.agent.maxSteps) === Number(preset.values.maxSteps);
    const card = presetCard(preset, applied);
    card.addEventListener('click', () => applyAgentPreset(key));
    grid.appendChild(card);
  }
}

function applyAgentPreset(key) {
  const preset = AGENT_PRESETS[key];
  if (!preset) return;
  Object.assign(state.settings.agent, preset.values);
  state.settings.permissions.mode = preset.mode;
  renderAgentPresets();
  renderAgentForm();
  renderPermissions();
  renderPermissionPresets();
  state.dirty = true;
  $('#saveState').textContent = 'Unsaved changes';
  toast(`${preset.label} preset applied — press Save changes`);
}

function renderPermissionPresets() {
  const grid = $('#permissionPresetGrid');
  if (!grid) return;
  grid.textContent = '';
  for (const [key, preset] of Object.entries(PERMISSION_PRESETS)) {
    const card = presetCard(preset, state.settings.permissions.mode === preset.mode);
    card.addEventListener('click', () => applyPermissionPreset(key));
    grid.appendChild(card);
  }
}

function applyPermissionPreset(key) {
  const preset = PERMISSION_PRESETS[key];
  if (!preset) return;
  state.settings.permissions.mode = preset.mode;
  renderPermissions();
  renderPermissionPresets();
  renderAgentPresets();
  state.dirty = true;
  $('#saveState').textContent = 'Unsaved changes';
  toast(`${preset.label} permission preset applied — press Save changes`);
}

function renderAppearancePresets() {
  const grid = $('#appearancePresetGrid');
  if (!grid) return;
  grid.textContent = '';
  const ui = state.settings.ui || {};
  for (const [key, preset] of Object.entries(APPEARANCE_PRESETS)) {
    const active =
      (ui.theme || 'system') === preset.values.theme &&
      (ui.density || 'comfortable') === preset.values.density;
    const card = presetCard(preset, active);
    card.addEventListener('click', () => applyAppearancePreset(key));
    grid.appendChild(card);
  }
}

function applyAppearancePreset(key) {
  const preset = APPEARANCE_PRESETS[key];
  if (!preset) return;
  Object.assign(state.settings.ui, preset.values);
  applyAppearance();
  renderAppearanceForm();
  renderAppearancePresets();
  state.dirty = true;
  $('#saveState').textContent = 'Unsaved changes';
  toast(`${preset.label} appearance preset applied — press Save changes`);
}

function presetCard(preset, applied) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `preset-card${applied ? ' is-applied' : ''}`;
  card.innerHTML = `<span class="preset-name"></span><span class="preset-desc"></span>`;
  $('.preset-name', card).textContent = preset.label;
  $('.preset-desc', card).textContent = preset.description;
  return card;
}

function applyAppearance() {
  document.documentElement.dataset.theme = state.settings.ui.theme || 'system';
}

function renderProfiles() {
  const list = $('#profileList');
  list.textContent = '';
  const active = getActiveProfile(state.settings);
  if (!state.settings.profiles.length) {
    list.appendChild(
      paragraph('No profiles yet. Add one to give Myna a brain.')
    );
    return;
  }
  for (const profile of state.settings.profiles) {
    const isActive = active?.id === profile.id;
    const row = document.createElement('div');
    row.className = `profile-row${isActive ? ' is-active' : ''}`;
    row.innerHTML = `
      <div class="profile-main">
        <div class="profile-name"></div>
        <div class="profile-meta"></div>
      </div>
      <div class="profile-actions"></div>
    `;
    $('.profile-name', row).textContent = profile.name;
    if (isActive) {
      const badge = document.createElement('span');
      badge.className = 'badge is-ok';
      badge.textContent = 'Active';
      $('.profile-name', row).appendChild(badge);
    }
    $('.profile-meta', row).textContent = `${profile.type === 'anthropic' ? 'Anthropic Messages' : 'OpenAI-compatible'} · ${profile.model} · ${
      profile.authStyle === 'none'
        ? 'no key'
        : profile.apiKey
          ? 'key saved'
          : 'no key'
    }`;
    const actions = $('.profile-actions', row);
    if (!isActive) {
      actions.appendChild(
        button('Use', 'button button-secondary button-small', () => {
          state.settings.activeProfileId = profile.id;
          persistSettings();
          renderProfiles();
        })
      );
    }
    actions.appendChild(
      button('Edit', 'button button-ghost button-small', () =>
        openEditor(profile)
      )
    );
    list.appendChild(row);
  }
}

function renderAgentForm() {
  const agent = state.settings.agent;
  $('#maxSteps').value = agent.maxSteps;
  $('#temperature').value = agent.temperature;
  $('#maxOutputTokens').value = agent.maxOutputTokens;
  $('#maxHistoryMessages').value = agent.maxHistoryMessages;
  $('#maxContextChars').value = agent.maxContextChars;
  $('#keepScreenshots').value = agent.keepScreenshots;
  $('#screenshotMaxWidth').value = agent.screenshotMaxWidth;
  $('#screenshotScale').value = agent.screenshotScale;
  $('#newTabUrl').value = agent.newTabUrl || 'https://www.google.com';
  $('#trustedInput').checked = !!agent.trustedInput;
  $('#openNewTabOnRestricted').checked = agent.openNewTabOnRestricted !== false;
  $('#animations').checked = agent.animations !== false;
  $('#groupTabs').checked = !!agent.groupTabs;
  $('#includePageContext').checked = !!agent.includePageContext;
  $('#includeSelectedText').checked = !!agent.includeSelectedText;
  $('#confirmDomainChanges').checked = !!agent.confirmDomainChanges;
  $('#enterToSend').checked = !!agent.enterToSend;
  $('#showReasoning').checked = !!agent.showReasoning;
  $('#streamResponses').checked = !!agent.streamResponses;
  $('#javascriptTool').checked = !!agent.javascriptTool;
  $('#customInstructions').value = state.settings.customInstructions || '';
  renderSkills();
}

function renderSkills() {
  const list = $('#skillsList');
  list.textContent = '';
  const skills = state.settings.skills || [];
  if (!skills.length) {
    list.appendChild(paragraph('No skills yet.'));
    return;
  }
  for (const skill of skills) {
    const row = document.createElement('div');
    row.className = 'skill-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!skill.enabled;
    input.dataset.skillId = skill.id;
    input.addEventListener('change', () => {
      const target = (state.settings.skills || []).find(
        (item) => item.id === skill.id
      );
      if (target) target.enabled = input.checked;
      markDirty();
    });
    const copy = document.createElement('span');
    copy.className = 'skill-copy';
    const name = document.createElement('span');
    name.className = 'skill-name';
    name.textContent = skill.name;
    const desc = document.createElement('span');
    desc.className = 'skill-desc';
    desc.textContent = skill.description || '';
    copy.append(name, document.createElement('br'), desc);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'rule-delete';
    del.textContent = '×';
    del.title = 'Delete skill';
    del.addEventListener('click', async () => {
      if (!window.confirm(`Delete skill “${skill.name}”?`)) return;
      state.settings.skills = (state.settings.skills || []).filter(
        (item) => item.id !== skill.id
      );
      state.settings = await saveSettings(state.settings);
      saveState('Saved');
      renderSkills();
    });
    row.append(input, copy, del);
    list.appendChild(row);
  }
}

function bindSkills() {
  $('#skillForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#skillName').value.trim();
    const instructions = $('#skillInstructions').value.trim();
    if (!name || !instructions) {
      toast('Skill name and instructions are required.', 'error');
      return;
    }
    state.settings.skills = [
      ...(state.settings.skills || []),
      {
        id: `skill_${crypto.randomUUID()}`,
        name,
        description: $('#skillDescription').value.trim(),
        instructions,
        icon: 'sparkles',
        enabled: true
      }
    ];
    state.settings = await saveSettings(state.settings);
    saveState('Saved');
    $('#skillForm').reset();
    renderSkills();
    toast('Skill added');
  });
}

function renderPermissions() {
  $('#defaultMode').value = state.settings.permissions.mode;
  $('#modeHint').textContent =
    {
      ask: 'Myna asks before reading a new site or taking an action.',
      auto: 'Myna can act without prompting, except on sensitive sites, new domains, and irreversible actions.',
      plan: 'Myna must present a plan and domains first. You approve before it acts.',
      readonly: 'Myna can read pages, but every action tool is denied.'
    }[state.settings.permissions.mode] || '';
  renderRules();
}

function renderRules() {
  const list = $('#rulesList');
  list.textContent = '';
  const rules = state.settings.permissions.rules || {};
  const entries = Object.entries(rules);
  if (!entries.length) {
    list.appendChild(
      paragraph('No site rules. Myna will ask by default unless you change the mode.')
    );
    return;
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  for (const [host, rule] of entries) {
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `
      <span class="rule-host"></span>
      <span class="rule-value"></span>
      <span class="rule-value"></span>
      <button class="rule-delete" type="button" title="Delete rule">×</button>
    `;
    $('.rule-host', row).textContent = host;
    $('.rule-value', row).textContent = `read: ${rule.read || 'ask'}`;
    $$('.rule-value', row)[1].textContent = `act: ${rule.act || 'ask'}`;
    $('.rule-delete', row).addEventListener('click', () => {
      delete state.settings.permissions.rules[host];
      state.dirty = true;
      $('#saveState').textContent = 'Unsaved changes';
      renderRules();
      persistSettings();
    });
    list.appendChild(row);
  }
}

function renderAppearanceForm() {
  $('#theme').value = state.settings.ui.theme || 'system';
  $('#density').value = state.settings.ui.density || 'comfortable';
}

function renderDataStats() {
  const messages = state.sessions.reduce(
    (sum, session) => sum + (session.messages?.length || 0),
    0
  );
  const keys = state.settings.profiles.filter((profile) => profile.apiKey).length;
  const bytes = new Blob([
    JSON.stringify({ settings: state.settings, sessions: state.sessions })
  ]).size;
  const stats = $('#storageStats');
  stats.textContent = '';
  stats.appendChild(stat(state.sessions.length, 'chats'));
  stats.appendChild(stat(messages, 'messages'));
  stats.appendChild(stat(keys, 'saved keys'));
  const size = document.createElement('div');
  size.className = 'form-hint';
  size.style.gridColumn = '1 / -1';
  size.textContent = `Approximately ${formatBytes(bytes)} of local data.`;
  stats.appendChild(size);
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

function bindProfileEditor() {
  $('#addProfileButton').addEventListener('click', () => openEditor(null));
  $('#cancelProfileButton').addEventListener('click', closeEditor);
  $('#presetSelect').addEventListener('change', () => {
    if (!state.editingId) applyPreset($('#presetSelect').value);
  });
  $('#toggleKeyButton').addEventListener('click', () => {
    const input = $('#apiKeyInput');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    $('#toggleKeyButton').textContent = showing ? 'Show' : 'Hide';
  });
  $('#modelPresetSelect').addEventListener('change', () => {
    const value = $('#modelPresetSelect').value;
    if (value) $('#modelInput').value = value;
  });
  $('#testProfileButton').addEventListener('click', testCurrentProfile);
  $('#fetchModelsButton').addEventListener('click', fetchCurrentModels);
  $('#deleteProfileButton').addEventListener('click', deleteCurrentProfile);
  $('#profileForm').addEventListener('submit', saveProfile);
}

function openEditor(profile, presetOverride = null) {
  state.editingId = profile?.id || null;
  $('#profileEditor').hidden = false;
  $('#editorTitle').textContent = profile ? 'Edit profile' : 'New profile';
  $('#deleteProfileButton').hidden = !profile;
  $('#profileTestResult').textContent = '';
  const presetKey =
    presetOverride ||
    (profile?.preset && PROVIDER_PRESETS[profile.preset]
      ? profile.preset
      : profile
        ? 'custom'
        : 'anthropic');
  $('#presetSelect').value = presetKey;
  if (profile) {
    fillForm(profile);
  } else {
    applyPreset(presetKey);
  }
  $('#profileEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEditor() {
  state.editingId = null;
  $('#profileEditor').hidden = true;
  $('#profileForm').reset();
  $('#profileTestResult').textContent = '';
}

function applyPreset(key) {
  const preset = PROVIDER_PRESETS[key];
  if (!preset) return;
  const headers = { ...(preset.headers || {}) };
  if (key.startsWith('opencodeGo') && !headers['x-opencode-session']) {
    headers['x-opencode-session'] = crypto.randomUUID();
  }
  $('#presetHint').textContent = preset.hint || '';
  $('#profileName').value = preset.label;
  $('#profileType').value = preset.type;
  $('#baseUrl').value = preset.baseUrl;
  $('#modelInput').value = preset.model;
  $('#authStyle').value = preset.authStyle;
  $('#apiKeyInput').value = '';
  $('#sessionOnlyKey').checked = false;
  $('#headersInput').value = Object.keys(headers).length
    ? JSON.stringify(headers, null, 2)
    : '';
  $('#maxTokensInput').value = preset.maxOutputTokens || 4096;
  $('#contextWindowInput').value = preset.contextWindow || 128000;
  $('#temperatureInput').value = '';
  $('#queryInput').value = preset.query || '';
  $('#supportsImages').checked = preset.supportsImages !== false;
  $('#includeCacheControl').checked = preset.includeCacheControl === true;
  $('#deleteProfileButton').hidden = !state.editingId;
  renderModelPresets(key);
}

function renderModelPresets(key) {
  const select = $('#modelPresetSelect');
  if (!select) return;
  select.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a preset…';
  select.appendChild(placeholder);
  for (const model of MODEL_PRESETS[key] || []) {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  }
  select.value = '';
}

function fillForm(profile) {
  $('#presetHint').textContent =
    PROVIDER_PRESETS[profile.preset]?.hint ||
    'Any OpenAI-compatible endpoint works.';
  $('#profileName').value = profile.name;
  $('#profileType').value = profile.type;
  $('#baseUrl').value = profile.baseUrl;
  $('#modelInput').value = profile.model;
  $('#authStyle').value = profile.authStyle;
  $('#apiKeyInput').value = profile.apiKey || '';
  $('#sessionOnlyKey').checked = !!profile.sessionOnlyKey;
  $('#headersInput').value =
    profile.headers && Object.keys(profile.headers).length
      ? JSON.stringify(profile.headers, null, 2)
      : '';
  $('#maxTokensInput').value = profile.maxOutputTokens;
  $('#contextWindowInput').value = profile.contextWindow;
  $('#temperatureInput').value =
    profile.temperature === undefined ? '' : profile.temperature;
  $('#queryInput').value = profile.query || '';
  $('#supportsImages').checked = profile.supportsImages !== false;
  $('#includeCacheControl').checked = profile.includeCacheControl !== false;
  renderModelPresets($('#presetSelect').value);
}

function readProfileForm() {
  let headers = {};
  const headerText = $('#headersInput').value.trim();
  if (headerText) {
    try {
      headers = JSON.parse(headerText);
      if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
        throw new Error('Headers must be a JSON object.');
      }
    } catch (error) {
      throw new Error(`Extra headers: ${error.message}`);
    }
  }
  const temperature = $('#temperatureInput').value.trim();
  return {
    id: state.editingId || undefined,
    name: $('#profileName').value.trim() || 'Untitled provider',
    type: $('#profileType').value,
    baseUrl: $('#baseUrl').value.trim(),
    model: $('#modelInput').value.trim(),
    authStyle: $('#authStyle').value,
    apiKey: $('#apiKeyInput').value.trim(),
    sessionOnlyKey: $('#sessionOnlyKey').checked,
    headers,
    maxOutputTokens: Number($('#maxTokensInput').value) || 4096,
    contextWindow: Number($('#contextWindowInput').value) || 128000,
    temperature: temperature === '' ? undefined : Number(temperature),
    query: $('#queryInput').value.trim(),
    supportsImages: $('#supportsImages').checked,
    includeCacheControl: $('#includeCacheControl').checked,
    preset: $('#presetSelect').value
  };
}

async function saveProfile(event) {
  event.preventDefault();
  let data;
  try {
    data = readProfileForm();
  } catch (error) {
    toast(formatError(error), 'error');
    return;
  }
  if (!data.baseUrl || !data.model) {
    toast('Base URL and model are required.', 'error');
    return;
  }
  const profile = normalizeProfile({
    ...data,
    id: data.id || uid('p_'),
    createdAt:
      state.settings.profiles.find((item) => item.id === data.id)?.createdAt ||
      Date.now(),
    updatedAt: Date.now()
  });
  const profiles = state.settings.profiles.filter(
    (item) => item.id !== profile.id
  );
  profiles.push(profile);
  state.settings.profiles = profiles;
  if (!state.settings.activeProfileId) state.settings.activeProfileId = profile.id;
  state.settings = await saveSettings(state.settings);
  state.editingId = profile.id;
  $('#editorTitle').textContent = 'Edit profile';
  $('#deleteProfileButton').hidden = false;
  toast('Profile saved');
  renderProfiles();
  saveState('Saved');
}

async function testCurrentProfile() {
  let data;
  try {
    data = readProfileForm();
  } catch (error) {
    toast(formatError(error), 'error');
    return;
  }
  const profile = normalizeProfile({ ...data, id: data.id || uid('p_') });
  const resultEl = $('#profileTestResult');
  resultEl.textContent = 'Testing…';
  try {
    const result = await testProfile(profile);
    resultEl.textContent = `Connected in ${result.latencyMs}ms — “${result.model}”`;
    resultEl.style.color = 'var(--success)';
  } catch (error) {
    resultEl.textContent = formatError(error);
    resultEl.style.color = 'var(--danger)';
  }
}

async function fetchCurrentModels() {
  let data;
  try {
    data = readProfileForm();
  } catch (error) {
    toast(formatError(error), 'error');
    return;
  }
  const profile = normalizeProfile({ ...data, id: data.id || uid('p_') });
  toast('Fetching models…');
  try {
    const models = await fetchModels(profile);
    document.querySelector('#modelOptions')?.remove();
    const datalist = document.createElement('datalist');
    datalist.id = 'modelOptions';
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model;
      datalist.appendChild(option);
    }
    document.body.appendChild(datalist);
    $('#modelInput').setAttribute('list', 'modelOptions');
    toast(`Found ${models.length} models`);
  } catch (error) {
    toast(formatError(error), 'error');
  }
}

async function deleteCurrentProfile() {
  if (!state.editingId) return;
  if (!window.confirm('Delete this provider profile? The saved API key will be removed.')) {
    return;
  }
  state.settings.profiles = state.settings.profiles.filter(
    (profile) => profile.id !== state.editingId
  );
  if (state.settings.activeProfileId === state.editingId) {
    state.settings.activeProfileId = state.settings.profiles[0]?.id || null;
  }
  state.settings = await saveSettings(state.settings);
  closeEditor();
  renderProfiles();
  toast('Profile deleted');
}

/* ------------------------------------------------------------------ */
/* Scheduled tasks                                                     */
/* ------------------------------------------------------------------ */

function bindTasks() {
  $('#taskFrequency').addEventListener('change', () => {
    $('#taskDayRow').hidden = $('#taskFrequency').value !== 'weekly';
  });
  $('#taskForm').addEventListener('submit', addTask);
  $('#reconcileTasksButton').addEventListener('click', async () => {
    const response = await sendMessage({ type: 'myna.reconcile_tasks' });
    toast(response?.ok ? 'Alarms rescheduled' : response?.error || 'Could not reschedule', response?.ok ? 'info' : 'error');
  });
  $('#taskDayRow').hidden = $('#taskFrequency').value !== 'weekly';
}

async function addTask(event) {
  event.preventDefault();
  const name = $('#taskName').value.trim();
  const prompt = $('#taskPrompt').value.trim();
  const url = $('#taskUrl').value.trim() || 'about:blank';
  if (!name || !prompt) {
    toast('Name and prompt are required.', 'error');
    return;
  }
  if (!/^https?:\/\//i.test(url) && url !== 'about:blank') {
    toast('Start URL must be http(s).', 'error');
    return;
  }
  const task = {
    id: `task_${crypto.randomUUID()}`,
    name,
    prompt,
    url,
    enabled: true,
    frequency: $('#taskFrequency').value,
    time: $('#taskTime').value || '09:00',
    day: Number($('#taskDay').value) || 0,
    lastRun: 0,
    lastResult: '',
    lastError: ''
  };
  state.settings.tasks = [...(state.settings.tasks || []), task];
  state.settings = await saveSettings(state.settings);
  await sendMessage({ type: 'myna.reconcile_tasks' });
  saveState('Saved');
  $('#taskForm').reset();
  $('#taskTime').value = '09:00';
  $('#taskDayRow').hidden = true;
  renderTasks();
  toast('Scheduled task added');
}

function renderTasks() {
  const list = $('#taskList');
  if (!list) return;
  list.textContent = '';
  const tasks = state.settings.tasks || [];
  if (!tasks.length) {
    list.appendChild(paragraph('No scheduled tasks yet.'));
    return;
  }
  for (const task of tasks) {
    const row = document.createElement('div');
    row.className = 'task-row';
    row.innerHTML = `
      <div class="task-copy">
        <div class="task-name"></div>
        <div class="task-meta"></div>
        <div class="task-result"></div>
      </div>
      <div class="task-actions"></div>
    `;
    $('.task-name', row).textContent = task.name;
    const schedule =
      task.frequency === 'manual'
        ? 'Manual only'
        : task.frequency === 'weekly'
          ? `Weekly · ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][task.day] || 'Mon'} at ${task.time}`
          : `Daily at ${task.time}`;
    $('.task-meta', row).textContent = `${schedule} · ${
      task.enabled ? 'enabled' : 'paused'
    }${task.lastRun ? ` · last run ${new Date(task.lastRun).toLocaleString()}` : ''}`;
    const result = task.lastError || task.lastResult;
    if (result) {
      $('.task-result', row).textContent = task.lastError
        ? `Error: ${task.lastError}`
        : result;
      if (task.lastError) $('.task-result', row).style.color = 'var(--danger)';
    }
    const actions = $('.task-actions', row);
    actions.appendChild(
      button(task.enabled ? 'Pause' : 'Enable', 'button button-ghost button-small', () =>
        toggleTask(task)
      )
    );
    actions.appendChild(
      button('Run now', 'button button-secondary button-small', () =>
        runTask(task)
      )
    );
    actions.appendChild(
      button('Delete', 'button button-danger button-small', () => deleteTask(task))
    );
    list.appendChild(row);
  }
}

async function toggleTask(task) {
  task.enabled = !task.enabled;
  state.settings = await saveSettings(state.settings);
  await sendMessage({ type: 'myna.reconcile_tasks' });
  saveState('Saved');
  renderTasks();
}

async function runTask(task) {
  const response = await sendMessage({ type: 'myna.run_task', taskId: task.id });
  toast(response?.ok ? 'Opening a Myna window…' : response?.error || 'Could not run task', response?.ok ? 'info' : 'error');
}

async function deleteTask(task) {
  if (!window.confirm(`Delete “${task.name}”?`)) return;
  state.settings.tasks = (state.settings.tasks || []).filter(
    (item) => item.id !== task.id
  );
  state.settings = await saveSettings(state.settings);
  await sendMessage({ type: 'myna.delete_task', taskId: task.id });
  saveState('Saved');
  renderTasks();
  toast('Scheduled task deleted');
}

function sendMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      });
    } catch (error) {
      resolve({ ok: false, error: String(error) });
    }
  });
}

/* ------------------------------------------------------------------ */
/* MCP servers                                                         */
/* ------------------------------------------------------------------ */

function bindMcp() {
  $('#mcpForm').addEventListener('submit', addMcpServer);
}

async function addMcpServer(event) {
  event.preventDefault();
  const name = $('#mcpName').value.trim();
  const url = $('#mcpUrl').value.trim();
  if (!name || !url) {
    toast('MCP name and URL are required.', 'error');
    return;
  }
  let headers = {};
  try {
    if ($('#mcpHeaders').value.trim()) {
      headers = JSON.parse($('#mcpHeaders').value);
      if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
        throw new Error('Headers must be a JSON object.');
      }
    }
  } catch (error) {
    toast(error.message, 'error');
    return;
  }
  const server = {
    id: `mcp_${crypto.randomUUID()}`,
    name,
    url,
    headers,
    enabled: true
  };
  state.settings.mcpServers = [
    ...(state.settings.mcpServers || []),
    server
  ];
  state.settings = await saveSettings(state.settings);
  saveState('Saved');
  $('#mcpForm').reset();
  renderMcp();
  toast('MCP server added');
  testMcpServer(server);
}

function renderMcp() {
  const list = $('#mcpList');
  if (!list) return;
  list.textContent = '';
  const servers = state.settings.mcpServers || [];
  if (!servers.length) {
    list.appendChild(paragraph('No MCP servers configured.'));
    return;
  }
  for (const server of servers) {
    const row = document.createElement('div');
    row.className = 'task-row';
    row.innerHTML = `
      <div class="task-copy">
        <div class="task-name"></div>
        <div class="task-meta"></div>
        <div class="task-result"></div>
      </div>
      <div class="task-actions"></div>
    `;
    $('.task-name', row).textContent = server.name;
    $('.task-meta', row).textContent = `${server.url} · ${
      server.enabled ? 'enabled' : 'paused'
    }`;
    const actions = $('.task-actions', row);
    actions.appendChild(
      button(server.enabled ? 'Pause' : 'Enable', 'button button-ghost button-small', async () => {
        server.enabled = !server.enabled;
        state.settings = await saveSettings(state.settings);
        saveState('Saved');
        renderMcp();
      })
    );
    actions.appendChild(
      button('Test', 'button button-secondary button-small', () =>
        testMcpServer(server, row)
      )
    );
    actions.appendChild(
      button('Delete', 'button button-danger button-small', async () => {
        if (!window.confirm(`Delete MCP server “${server.name}”?`)) return;
        state.settings.mcpServers = (state.settings.mcpServers || []).filter(
          (item) => item.id !== server.id
        );
        state.settings = await saveSettings(state.settings);
        saveState('Saved');
        renderMcp();
      })
    );
    list.appendChild(row);
  }
}

async function testMcpServer(server, row = null) {
  const target =
    row || $$('#mcpList .task-row').find((item) => item.innerText.includes(server.name));
  const result = target?.querySelector('.task-result');
  if (result) result.textContent = 'Connecting…';
  try {
    const loaded = await loadMcpTools([server]);
    if (loaded.errors.length) throw new Error(loaded.errors[0].error);
    const text = `${loaded.tools.length} tool${
      loaded.tools.length === 1 ? '' : 's'
    }: ${loaded.tools.map((tool) => tool.mcp.toolName).join(', ')}`;
    if (result) result.textContent = text;
    if (result) result.style.color = '';
    toast(`${server.name}: ${loaded.tools.length} tools`);
  } catch (error) {
    if (result) {
      result.textContent = String(error.message || error);
      result.style.color = 'var(--danger)';
    }
    toast(String(error.message || error), 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Agent / permissions / appearance                                    */
/* ------------------------------------------------------------------ */

function bindAgentForm() {
  $('#customInstructions').addEventListener('input', markDirty);
}

function bindPermissions() {
  $('#defaultMode').addEventListener('change', () => {
    state.settings.permissions.mode = $('#defaultMode').value;
    renderPermissions();
    renderPermissionPresets();
    renderAgentPresets();
    markDirty();
  });
  $('#addRuleButton').addEventListener('click', addRule);
  $('#requestDebuggerButton').addEventListener('click', requestDebugger);
  $('#revokeDebuggerButton').addEventListener('click', revokeDebugger);
}

function addRule() {
  const host = normalizeHost($('#ruleHost').value);
  if (!host) {
    toast('Enter a host such as example.com', 'error');
    return;
  }
  const read = $('#ruleRead').value;
  const act = $('#ruleAct').value;
  const rule = {};
  if (read !== 'ask') rule.read = read;
  if (act !== 'ask') rule.act = act;
  if (!state.settings.permissions.rules) state.settings.permissions.rules = {};
  state.settings.permissions.rules[host] = rule;
  $('#ruleHost').value = '';
  renderRules();
  markDirty();
  persistSettings();
}

function bindData() {
  $('#exportButton').addEventListener('click', exportBackup);
  $('#importButton').addEventListener('click', () => $('#importInput').click());
  $('#importInput').addEventListener('change', importBackup);
  $('#clearChatsButton').addEventListener('click', clearChats);
  $('#clearKeysButton').addEventListener('click', clearKeys);
  $('#resetButton').addEventListener('click', resetAll);
}

function bindAppearance() {
  $('#theme').addEventListener('change', () => {
    const theme = $('#theme').value;
    document.documentElement.dataset.theme = theme;
    state.settings.ui.theme = theme;
    renderAppearancePresets();
    markDirty();
  });
  $('#density').addEventListener('change', () => {
    state.settings.ui.density = $('#density').value;
    renderAppearancePresets();
    markDirty();
  });
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

async function saveAll() {
  const newTabUrl = $('#newTabUrl').value.trim() || 'https://www.google.com';
  if (!/^https?:\/\//i.test(newTabUrl)) {
    toast('New-tab start page must be an http(s) URL.', 'error');
    return;
  }
  state.settings.agent = {
    ...state.settings.agent,
    maxSteps: numberOr($('#maxSteps').value, 20),
    temperature: numberOr($('#temperature').value, 0.7),
    maxOutputTokens: numberOr($('#maxOutputTokens').value, 4096),
    maxHistoryMessages: numberOr($('#maxHistoryMessages').value, 80),
    maxContextChars: numberOr($('#maxContextChars').value, 120000),
    keepScreenshots: numberOr($('#keepScreenshots').value, 2),
    screenshotMaxWidth: numberOr($('#screenshotMaxWidth').value, 1280),
    screenshotScale: numberOr($('#screenshotScale').value, 1),
    trustedInput: $('#trustedInput').checked,
    openNewTabOnRestricted: $('#openNewTabOnRestricted').checked,
    newTabUrl,
    animations: $('#animations').checked,
    groupTabs: $('#groupTabs').checked,
    includePageContext: $('#includePageContext').checked,
    includeSelectedText: $('#includeSelectedText').checked,
    confirmDomainChanges: $('#confirmDomainChanges').checked,
    enterToSend: $('#enterToSend').checked,
    showReasoning: $('#showReasoning').checked,
    streamResponses: $('#streamResponses').checked,
    javascriptTool: $('#javascriptTool').checked
  };
  state.settings.customInstructions = $('#customInstructions').value;
  state.settings.permissions.mode = $('#defaultMode').value;
  state.settings.ui.theme = $('#theme').value;
  state.settings.ui.density = $('#density').value;
  try {
    state.settings = await saveSettings(state.settings);
    state.dirty = false;
    saveState('Saved');
    toast('Settings saved');
    renderAll();
  } catch (error) {
    saveState('Save failed');
    toast(formatError(error), 'error');
  }
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function persistSettings() {
  try {
    state.settings = await saveSettings(state.settings);
    saveState('Saved');
  } catch (error) {
    toast(formatError(error), 'error');
  }
}

function saveState(text) {
  $('#saveState').textContent = text;
  if (text === 'Saved') {
    state.dirty = false;
    setTimeout(() => {
      if (!state.dirty) $('#saveState').textContent = '';
    }, 2000);
  }
}

/* ------------------------------------------------------------------ */
/* Debugger permission                                                 */
/* ------------------------------------------------------------------ */

async function refreshDebuggerStatus() {
  state.debuggerGranted = await chrome.permissions
    .contains({ permissions: ['debugger'] })
    .catch(() => false);
  const badge = $('#debuggerBadge');
  badge.textContent = state.debuggerGranted ? 'Granted' : 'Not granted';
  badge.className = `badge ${state.debuggerGranted ? 'is-ok' : 'is-off'}`;
  $('#requestDebuggerButton').disabled = state.debuggerGranted;
  $('#revokeDebuggerButton').disabled = !state.debuggerGranted;
}

async function requestDebugger() {
  try {
    const granted = await chrome.permissions.request({
      permissions: ['debugger']
    });
    state.debuggerGranted = granted;
    if (granted) {
      state.settings.agent.trustedInput = true;
      await saveSettings(state.settings);
      renderAgentForm();
      toast('Trusted browser control enabled');
    } else {
      toast('Permission declined', 'error');
    }
  } catch (error) {
    toast(formatError(error), 'error');
  }
  await refreshDebuggerStatus();
}

async function revokeDebugger() {
  try {
    await chrome.permissions.remove({ permissions: ['debugger'] });
    state.settings.agent.trustedInput = false;
    await saveSettings(state.settings);
    renderAgentForm();
    toast('Debugger permission revoked');
  } catch (error) {
    toast(formatError(error), 'error');
  }
  await refreshDebuggerStatus();
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

async function loadSessionsForStats() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SESSIONS);
  state.sessions = Array.isArray(stored[STORAGE_KEYS.SESSIONS])
    ? stored[STORAGE_KEYS.SESSIONS]
    : [];
}

function refreshStats() {
  renderDataStats();
}

async function exportBackup() {
  await loadSessionsForStats();
  const backup = {
    app: 'Myna',
    version: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    settings: {
      ...state.settings,
      profiles: state.settings.profiles.map((profile) =>
        profile.sessionOnlyKey ? { ...profile, apiKey: '' } : profile
      )
    },
    sessions: state.sessions
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `myna-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Backup downloaded');
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.settings || !Array.isArray(data.sessions)) {
      throw new Error('This does not look like a Myna backup.');
    }
    if (!window.confirm('Import this backup? It replaces current settings and chats.')) {
      return;
    }
    state.settings = await saveSettings(data.settings);
    await chrome.storage.local.set({ [STORAGE_KEYS.SESSIONS]: data.sessions });
    await loadSessionsForStats();
    await sendMessage({ type: 'myna.reconcile_tasks' });
    renderAll();
    toast('Backup imported');
  } catch (error) {
    toast(formatError(error), 'error');
  }
}

async function clearChats() {
  if (!window.confirm('Delete every Myna chat? This cannot be undone.')) return;
  await chrome.storage.local.remove([
    STORAGE_KEYS.SESSIONS,
    STORAGE_KEYS.ACTIVE_SESSION
  ]);
  state.sessions = [];
  renderDataStats();
  toast('Chats deleted');
}

async function clearKeys() {
  if (!window.confirm('Remove every saved API key? Profiles stay.')) return;
  state.settings.profiles = state.settings.profiles.map((profile) => ({
    ...profile,
    apiKey: ''
  }));
  state.settings = await saveSettings(state.settings);
  await chrome.storage.session.remove(STORAGE_KEYS.SESSION_SECRETS);
  renderProfiles();
  renderDataStats();
  toast('API keys removed');
}

async function resetAll() {
  if (
    !window.confirm(
      'Reset Myna completely? This deletes settings, profiles, API keys, rules, skills, and chats.'
    )
  ) {
    return;
  }
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  try {
    await chrome.alarms.clearAll();
  } catch {
    /* ignore */
  }
  location.reload();
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function paragraph(text) {
  const p = document.createElement('p');
  p.className = 'form-hint';
  p.textContent = text;
  return p;
}

function button(text, className, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function stat(value, label) {
  const wrap = document.createElement('div');
  wrap.className = 'stat';
  const v = document.createElement('div');
  v.className = 'stat-value';
  v.textContent = String(value);
  const l = document.createElement('div');
  l.className = 'stat-label';
  l.textContent = label;
  wrap.append(v, l);
  return wrap;
}

function toast(message, type = 'info') {
  const root = $('#toastRoot');
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' is-error' : ''}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
