import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRun } from '../src/background/scheduler.js';

const local = (value) => new Date(value).getTime();

test('nextRun picks the next daily occurrence', () => {
  const base = local('2026-10-24T08:00:00');
  const when = nextRun({ frequency: 'daily', time: '09:00' }, base);
  assert.equal(new Date(when).getHours(), 9);
  assert.equal(new Date(when).getDate(), 24);
});

test('nextRun rolls a past time to tomorrow', () => {
  const base = local('2026-10-24T10:00:00');
  const when = nextRun({ frequency: 'daily', time: '09:00' }, base);
  assert.equal(new Date(when).getDate(), 25);
  assert.equal(new Date(when).getHours(), 9);
});

test('nextRun finds the next weekly weekday', () => {
  const saturday = local('2026-10-24T12:00:00');
  const when = nextRun(
    { frequency: 'weekly', day: 1, time: '09:00' },
    saturday
  );
  const date = new Date(when);
  assert.equal(date.getDay(), 1);
  assert.ok(date.getTime() > saturday);
});

test('nextRun returns null for manual tasks', () => {
  assert.equal(nextRun({ frequency: 'manual', time: '09:00' }), null);
});
