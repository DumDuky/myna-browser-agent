/** Local scheduled tasks: one-shot alarms that open a runner page. */

import { loadSettings, saveSettings } from '../lib/settings.js';
import { uid } from '../lib/util.js';

const PREFIX = 'myna_task_';

export function nextRun(task, from = Date.now()) {
  if (!task || task.frequency === 'manual') return null;
  const [hours, minutes] = String(task.time || '09:00')
    .split(':')
    .map((part) => Number(part) || 0);
  const now = new Date(from);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (task.frequency === 'weekly') {
    const targetDay = Math.max(0, Math.min(6, Number(task.day) || 0));
    const delta = (targetDay - next.getDay() + 7) % 7;
    next.setDate(next.getDate() + delta);
  }
  if (next.getTime() <= now.getTime() + 1000) {
    next.setDate(next.getDate() + (task.frequency === 'weekly' ? 7 : 1));
  }
  return next.getTime();
}

export async function reconcileTasks() {
  const settings = await loadSettings();
  const tasks = settings.tasks || [];
  const existing = await chrome.alarms.getAll();
  for (const alarm of existing) {
    if (alarm.name.startsWith(PREFIX)) await chrome.alarms.clear(alarm.name);
  }
  for (const task of tasks) {
    if (!task.enabled || task.frequency === 'manual') continue;
    const when = nextRun(task);
    if (!when) continue;
    await chrome.alarms.create(`${PREFIX}${task.id}`, { when });
  }
  return { count: tasks.filter((task) => task.enabled).length };
}

export async function scheduleTask(task) {
  const name = `${PREFIX}${task.id}`;
  await chrome.alarms.clear(name);
  if (!task.enabled || task.frequency === 'manual') return null;
  const when = nextRun(task);
  if (!when) return null;
  await chrome.alarms.create(name, { when });
  return when;
}

export async function handleAlarm(alarm) {
  if (!alarm?.name?.startsWith(PREFIX)) return false;
  const id = alarm.name.slice(PREFIX.length);
  const settings = await loadSettings();
  const task = (settings.tasks || []).find((item) => item.id === id);
  if (!task || !task.enabled) return false;
  await openRunner(task.id);
  await scheduleTask(task);
  return true;
}

export async function runTaskNow(taskId) {
  return openRunner(taskId);
}

async function openRunner(taskId) {
  const url = chrome.runtime.getURL(
    `src/runner/index.html?taskId=${encodeURIComponent(taskId)}`
  );
  await chrome.windows.create({
    url,
    type: 'normal',
    focused: true,
    width: 1280,
    height: 900
  });
  return { ok: true };
}

export async function addTask(task) {
  const settings = await loadSettings();
  const next = {
    ...task,
    id: task.id || uid('task_'),
    enabled: task.enabled !== false
  };
  settings.tasks = [...(settings.tasks || []), next];
  const saved = await saveSettings(settings);
  await scheduleTask(next);
  return { task: next, settings: saved };
}

export async function updateTask(id, patch) {
  const settings = await loadSettings();
  let updated = null;
  settings.tasks = (settings.tasks || []).map((task) => {
    if (task.id !== id) return task;
    updated = { ...task, ...patch };
    return updated;
  });
  const saved = await saveSettings(settings);
  if (updated) await scheduleTask(updated);
  return { task: updated, settings: saved };
}

export async function deleteTask(id) {
  const settings = await loadSettings();
  settings.tasks = (settings.tasks || []).filter((task) => task.id !== id);
  await chrome.alarms.clear(`${PREFIX}${id}`);
  const saved = await saveSettings(settings);
  return { settings: saved };
}

export async function recordTaskResult(id, { text = '', error = '' } = {}) {
  const settings = await loadSettings();
  settings.tasks = (settings.tasks || []).map((task) =>
    task.id === id
      ? {
          ...task,
          lastRun: Date.now(),
          lastResult: String(text || '').slice(0, 4000),
          lastError: String(error || '').slice(0, 2000)
        }
      : task
  );
  return saveSettings(settings);
}

export async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('src/assets/icon-128.png'),
      title,
      message: String(message || '').slice(0, 300)
    });
  } catch {
    /* notifications are optional */
  }
}
