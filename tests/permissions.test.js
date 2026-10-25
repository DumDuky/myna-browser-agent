import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addSiteRule,
  checkPermission,
  isDomainApproved,
  normalizeHost,
  permissionRequestText,
  ruleForHost
} from '../src/lib/permissions.js';
import { PERMISSION_MODES, TOOL_KIND } from '../src/lib/constants.js';

const baseSettings = {
  permissions: { mode: PERMISSION_MODES.ASK, rules: {} },
  agent: {}
};

test('normalizes hosts and matches parent domains', () => {
  assert.equal(normalizeHost('https://www.Example.com/path'), 'example.com');
  assert.equal(normalizeHost('Example.com'), 'example.com');
  const rules = { 'example.com': { read: 'allow' } };
  assert.deepEqual(ruleForHost(rules, 'www.example.com').host, 'example.com');
  assert.equal(ruleForHost(rules, 'notexample.com'), null);
});

test('ask mode prompts for unapproved reads and actions', () => {
  const read = checkPermission({
    settings: baseSettings,
    host: 'example.com',
    kind: TOOL_KIND.READ
  });
  assert.equal(read.allowed, false);
  assert.equal(read.needsPrompt, true);
  const act = checkPermission({
    settings: baseSettings,
    host: 'example.com',
    kind: TOOL_KIND.ACT
  });
  assert.equal(act.needsPrompt, true);
});

test('site rules allow or block', () => {
  const settings = addSiteRule(baseSettings, 'example.com', 'both', 'allow');
  const read = checkPermission({
    settings,
    host: 'www.example.com',
    kind: TOOL_KIND.READ
  });
  assert.equal(read.allowed, true);
  const blocked = addSiteRule(settings, 'example.com', 'both', 'block');
  assert.equal(
    checkPermission({
      settings: blocked,
      host: 'example.com',
      kind: TOOL_KIND.ACT
    }).allowed,
    false
  );
});

test('auto mode allows actions but sensitive hosts still prompt', () => {
  const settings = { ...baseSettings, permissions: { ...baseSettings.permissions, mode: 'auto' } };
  assert.equal(
    checkPermission({
      settings,
      host: 'example.com',
      kind: TOOL_KIND.ACT
    }).allowed,
    true
  );
  const bank = checkPermission({
    settings,
    host: 'mybank.com',
    kind: TOOL_KIND.ACT
  });
  assert.equal(bank.allowed, false);
  assert.equal(bank.needsPrompt, true);
});

test('readonly denies actions', () => {
  const settings = { ...baseSettings, permissions: { ...baseSettings.permissions, mode: 'readonly' } };
  const result = checkPermission({
    settings,
    host: 'example.com',
    kind: TOOL_KIND.ACT
  });
  assert.equal(result.allowed, false);
  assert.equal(result.needsPrompt, false);
});

test('plan mode requires approved domains', () => {
  const settings = { ...baseSettings, permissions: { ...baseSettings.permissions, mode: 'plan' } };
  assert.equal(
    checkPermission({
      settings,
      host: 'example.com',
      kind: TOOL_KIND.ACT
    }).allowed,
    false
  );
  assert.equal(
    checkPermission({
      settings,
      host: 'example.com',
      kind: TOOL_KIND.ACT,
      approvedDomains: ['example.com']
    }).allowed,
    true
  );
  assert.equal(isDomainApproved('www.example.com', ['example.com']), true);
});

test('permission prompt text is human readable', () => {
  assert.match(
    permissionRequestText({
      toolName: 'computer',
      input: { action: 'left_click' },
      host: 'example.com',
      kind: TOOL_KIND.ACT
    }),
    /click on example\.com/
  );
});
