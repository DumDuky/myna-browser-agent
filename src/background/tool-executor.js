/**
 * Tool execution. Runs in the service worker and is the only place that uses
 * privileged browser APIs.
 */

import {
  MAX_BATCH_ACTIONS,
  TOOL_KIND
} from '../lib/constants.js';
import { loadSettings, saveSettings } from '../lib/settings.js';
import {
  addSiteRule,
  checkPermission,
  isDomainApproved,
  normalizeHost,
  permissionRequestText
} from '../lib/permissions.js';
import {
  hostOf,
  isRestrictedUrl,
  sleep,
  stripAnsi,
  truncate
} from '../lib/util.js';
import {
  addTabToGroup,
  closeTab,
  createTab,
  getTab,
  navigateTab,
  pageCall,
  resizeWindow,
  summarizeTabs,
  tabContext
} from './tabs.js';
import {
  captureFrame,
  frameSummary,
  mapCoordinate
} from './screenshots.js';
import {
  clearRecording,
  downloadGif,
  exportGif,
  isRecording,
  recordFrame,
  recordingState,
  startRecording,
  stopRecording
} from './gif-recorder.js';
import {
  click as cdpClick,
  drag as cdpDrag,
  hasDebuggerPermission,
  insertText as cdpInsertText,
  moveMouse as cdpMoveMouse,
  pressKey as cdpPressKey,
  readConsoleMessages,
  readNetworkRequests,
  scrollWheel as cdpScrollWheel,
  sendCommand
} from './cdp.js';

export class ToolError extends Error {
  constructor(message, code = 'tool_error') {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

/**
 * Execute one tool call.
 *
 * context = {
 *   tabId, groupId, mode, approvedDomains, toolUseId, suppressTabContext
 * }
 */
export async function executeTool({ name, input = {}, context = {} }) {
  const settings = await loadSettings();
  const ctx = {
    ...context,
    settings,
    mode: context.mode || settings.permissions.mode,
    approvedDomains: context.approvedDomains || [],
    groupId: context.groupId ?? null
  };
  try {
    switch (name) {
      case 'read_page':
        return await runReadPage(input, ctx);
      case 'get_page_text':
        return await runGetPageText(input, ctx);
      case 'find':
        return await runFind(input, ctx);
      case 'form_input':
        return await runFormInput(input, ctx);
      case 'file_upload':
        return await runFileUpload(input, ctx);
      case 'computer':
        return await runComputer(input, ctx);
      case 'navigate':
        return await runNavigate(input, ctx);
      case 'web_fetch':
        return await runWebFetch(input, ctx);
      case 'web_search':
        return await runWebSearch(input, ctx);
      case 'tabs_context':
        return await runTabsContext(input, ctx);
      case 'tabs_create':
        return await runTabsCreate(input, ctx);
      case 'tabs_close':
        return await runTabsClose(input, ctx);
      case 'read_console_messages':
        return await runReadConsole(input, ctx);
      case 'read_network_requests':
        return await runReadNetwork(input, ctx);
      case 'resize_window':
        return await runResize(input, ctx);
      case 'browser_batch':
        return await runBatch(input, ctx);
      case 'gif_creator':
        return await runGifCreator(input, ctx);
      case 'javascript_tool':
        return await runJavascript(input, ctx);
      case 'update_plan':
        return {
          ok: false,
          name,
          error:
            'update_plan is handled by the side panel. Do not call it through the browser tool executor.',
          errorCode: 'plan_in_panel'
        };
      default:
        throw new ToolError(`Unknown tool: ${name}`, 'unknown_tool');
    }
  } catch (error) {
    const message =
      error instanceof ToolError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      ok: false,
      name,
      error: message,
      errorCode: error?.code || 'tool_error'
    };
  }
}

/* ------------------------------------------------------------------ */
/* Read tools                                                          */
/* ------------------------------------------------------------------ */

async function runReadPage(input, ctx) {
  const tab = await resolveTab(input.tabId, ctx);
  await authorize({
    ctx,
    toolName: 'read_page',
    input,
    kind: TOOL_KIND.READ,
    url: tab.url
  });
  await showIndicator(tab.id, 'Reading page…');
  const result = await pageCall(tab.id, 'tree', [input]);
  await hideIndicatorSoon(tab.id);
  if (result?.error) {
    return {
      ok: false,
      name: 'read_page',
      error: result.error,
      errorCode: 'read_page_error'
    };
  }
  const info = await pageInfoSafe(tab.id);
  const header = [
    `Title: ${truncate(info?.title || tab.title || '', 200)}`,
    `URL: ${truncate(tab.url || info?.url || '', 500)}`,
    `Viewport: ${Math.round(result.viewport?.width || 0)}×${Math.round(
      result.viewport?.height || 0
    )} CSS px`,
    `Elements: ${result.elementCount || 0}; refs: ${result.refCount || 0}`,
    '---'
  ].join('\n');
  return {
    ok: true,
    name: 'read_page',
    output: `${header}\n${result.pageContent || '(no accessible content)'}`,
    data: {
      viewport: result.viewport,
      truncated: !!result.truncated,
      elementCount: result.elementCount,
      refCount: result.refCount
    }
  };
}

async function runGetPageText(input, ctx) {
  const tab = await resolveTab(input.tabId, ctx);
  await authorize({
    ctx,
    toolName: 'get_page_text',
    input,
    kind: TOOL_KIND.READ,
    url: tab.url
  });
  await showIndicator(tab.id, 'Extracting text…');
  const result = await pageCall(tab.id, 'text', [input]);
  await hideIndicatorSoon(tab.id);
  if (result?.error) {
    return {
      ok: false,
      name: 'get_page_text',
      error: result.error,
      errorCode: 'no_text'
    };
  }
  const output = [
    `Title: ${truncate(result.title || '', 200)}`,
    `URL: ${truncate(result.url || tab.url || '', 500)}`,
    `Source: <${result.source || 'body'}>`,
    '---',
    result.text || ''
  ].join('\n');
  return {
    ok: true,
    name: 'get_page_text',
    output,
    data: { length: result.length, source: result.source }
  };
}

async function runFind(input, ctx) {
  const query = String(input.query || '').trim();
  if (!query) throw new ToolError('find needs a query.', 'missing_query');
  const tab = await resolveTab(input.tabId, ctx);
  await authorize({
    ctx,
    toolName: 'find',
    input,
    kind: TOOL_KIND.READ,
    url: tab.url
  });
  await showIndicator(tab.id, `Finding “${truncate(query, 40)}”…`);
  const result = await pageCall(tab.id, 'find', [query, 20]);
  await hideIndicatorSoon(tab.id);
  const matches = result?.matches || [];
  if (!matches.length) {
    return {
      ok: false,
      name: 'find',
      error: `No matches for “${query}”. Try a broader description or call read_page to see the page structure.`,
      errorCode: 'find_no_match'
    };
  }
  const lines = matches.map(
    (item) =>
      `- ${item.ref}: ${item.role}${
        item.name ? ` “${item.name}”` : ''
      }${item.type ? ` (${item.type})` : ''}`
  );
  const header = `Found ${
    result.total || matches.length
  } matching element${(result.total || matches.length) === 1 ? '' : 's'}${
    result.truncated ? ' (showing the best matches; refine the query for more)' : ''
  }:`;
  return {
    ok: true,
    name: 'find',
    output: `${header}\n${lines.join('\n')}`,
    data: { matches, total: result.total }
  };
}

async function runFormInput(input, ctx) {
  const ref = String(input.ref || '').trim();
  if (!ref) throw new ToolError('form_input needs a ref.', 'missing_ref');
  if (input.value === undefined) {
    throw new ToolError('form_input needs a value.', 'missing_value');
  }
  const tab = await resolveTab(input.tabId, ctx);
  await authorize({
    ctx,
    toolName: 'form_input',
    input,
    kind: TOOL_KIND.ACT,
    url: tab.url
  });
  await showIndicator(tab.id, 'Filling a field…');
  const resolved = await pageCall(tab.id, 'resolve', [ref]).catch(() => null);
  if (resolved?.success) {
    await animate(ctx, tab.id, 'cursorTo', [
      resolved.x,
      resolved.y,
      { label: 'Fill' }
    ]);
    await animate(ctx, tab.id, 'typingAt', [resolved.x, resolved.y], 80);
  }
  const result = await pageCall(tab.id, 'formInput', [ref, input.value]);
  await hideIndicatorSoon(tab.id);
  if (isRecording(tab.id)) await recordFrame(tab.id);
  if (result?.error) {
    return {
      ok: false,
      name: 'form_input',
      error: result.error,
      errorCode: 'form_input_failed'
    };
  }
  const context = await maybeTabContext(tab.id, ctx);
  return {
    ok: true,
    name: 'form_input',
    output: result.output || `Updated ${ref}.`,
    ...context
  };
}

/* ------------------------------------------------------------------ */
/* File upload                                                         */
/* ------------------------------------------------------------------ */

async function runFileUpload(input, ctx) {
  const ref = String(input.ref || '').trim();
  if (!ref) throw new ToolError('file_upload needs a file input ref.', 'missing_ref');
  const files = Array.isArray(ctx.files) ? ctx.files : [];
  if (!files.length) {
    throw new ToolError(
      'No files are attached. Ask the user to attach files with the Files button in Myna first.',
      'no_files'
    );
  }
  const tab = await resolveTab(input.tabId, ctx);
  await authorize({
    ctx,
    toolName: 'file_upload',
    input,
    kind: TOOL_KIND.ACT,
    url: tab.url
  });
  await showIndicator(tab.id, 'Attaching files…');
  const resolved = await pageCall(tab.id, 'resolve', [ref]).catch(() => null);
  if (resolved?.success) {
    await animate(ctx, tab.id, 'cursorTo', [
      resolved.x,
      resolved.y,
      { label: 'Upload' }
    ]);
  }
  const result = await pageCall(tab.id, 'uploadFiles', [ref, files]);
  await hideIndicatorSoon(tab.id);
  if (result?.error) {
    return {
      ok: false,
      name: 'file_upload',
      error: result.error,
      errorCode: 'file_upload_failed'
    };
  }
  return {
    ok: true,
    name: 'file_upload',
    output: result.output || `Attached ${files.length} file(s).`,
    data: { count: files.length, names: files.map((file) => file.name) },
    ...(await maybeTabContext(tab.id, ctx))
  };
}

/* ------------------------------------------------------------------ */
/* Computer                                                            */
/* ------------------------------------------------------------------ */

const READ_ONLY_ACTIONS = new Set([
  'screenshot',
  'wait',
  'scroll',
  'scroll_to',
  'hover',
  'zoom'
]);

async function runComputer(input, ctx) {
  const action = String(input.action || '').trim();
  if (!action) throw new ToolError('computer needs an action.', 'missing_action');
  const tab = await resolveTab(input.tabId, ctx);
  const kind = READ_ONLY_ACTIONS.has(action) ? TOOL_KIND.READ : TOOL_KIND.ACT;

  if (action === 'screenshot' || action === 'zoom') {
    await authorize({
      ctx,
      toolName: 'computer',
      input,
      kind: TOOL_KIND.READ,
      url: tab.url
    });
    const region =
      action === 'zoom' && Array.isArray(input.region)
        ? input.region.map(Number)
        : null;
    if (action === 'zoom' && (!region || region.length !== 4)) {
      throw new ToolError('zoom needs a region [x0, y0, x1, y1].', 'bad_region');
    }
    await hideIndicatorNow(tab.id);
    const frame = await captureFrame(tab.id, {
      maxWidth: ctx.settings.agent.screenshotMaxWidth,
      scale: Number(input.scale) || ctx.settings.agent.screenshotScale || 1,
      region
    });
    await hideIndicatorSoon(tab.id);
    const label =
      action === 'zoom'
        ? `Zoomed screenshot of ${Math.round(frame.cssWidth)}×${Math.round(
            frame.cssHeight
          )} page region`
        : 'Screenshot captured';
    const coordinatesNote =
      frame.scaleX !== 1 || frame.scaleY !== 1
        ? ` The image is scaled; use its pixel coordinates and Myna will map them.`
        : '';
    return {
      ok: true,
      name: 'computer',
      output: `${label} (${frame.imageWidth}×${frame.imageHeight}, ${frame.format}). ${frameSummary(
        frame
      )}.${coordinatesNote}`,
      images: [
        {
          dataUrl: frame.dataUrl,
          mediaType: `image/${frame.format === 'jpeg' ? 'jpeg' : 'png'}`,
          width: frame.imageWidth,
          height: frame.imageHeight
        }
      ],
      data: {
        frame: {
          width: frame.imageWidth,
          height: frame.imageHeight,
          cssX: frame.cssX,
          cssY: frame.cssY,
          cssWidth: frame.cssWidth,
          cssHeight: frame.cssHeight
        }
      },
      ...(await maybeTabContext(tab.id, ctx))
    };
  }

  await authorize({
    ctx,
    toolName: 'computer',
    input,
    kind,
    url: tab.url
  });

  if (action === 'wait') {
    const seconds = Math.max(0, Math.min(10, Number(input.duration) || 1));
    await showIndicator(tab.id, `Waiting ${seconds}s…`);
    await sleep(seconds * 1000);
    await hideIndicatorSoon(tab.id);
    return {
      ok: true,
      name: 'computer',
      output: `Waited ${seconds} second${seconds === 1 ? '' : 's'}.`
    };
  }

  if (action === 'scroll_to') {
    const ref = String(input.ref || '');
    if (!ref) throw new ToolError('scroll_to needs a ref.', 'missing_ref');
    await showIndicator(tab.id, 'Scrolling to element…');
    const result = await pageCall(tab.id, 'scrollToRef', [ref]);
    await hideIndicatorSoon(tab.id);
    if (result?.error) throw new ToolError(result.error, 'scroll_failed');
    return {
      ok: true,
      name: 'computer',
      output: result.output || `Scrolled ${ref} into view.`,
      ...(await maybeTabContext(tab.id, ctx))
    };
  }

  if (action === 'scroll') {
    const direction = input.scroll_direction || 'down';
    const amount = Math.max(1, Math.min(10, Number(input.scroll_amount) || 3));
    await showIndicator(tab.id, `Scrolling ${direction}…`);
    await animate(ctx, tab.id, 'scrollHint', [direction]);
    let output = '';
    const canDebug = await hasDebuggerPermission();
    if (input.ref) {
      const resolved = await pageCall(tab.id, 'resolve', [input.ref]);
      if (!resolved?.success) throw new ToolError(resolved?.error || 'Element not found.', 'ref_stale');
      await pageCall(tab.id, 'scrollToRef', [input.ref]);
      output = `Scrolled to ${input.ref}.`;
    } else if (input.coordinate && canDebug) {
      const point = mapPoint(tab.id, input.coordinate);
      const step = amount * 120;
      await cdpScrollWheel(tab.id, {
        x: point.x,
        y: point.y,
        deltaX: direction === 'left' ? -step : direction === 'right' ? step : 0,
        deltaY: direction === 'up' ? -step : direction === 'down' ? step : 0
      });
      output = `Scrolled ${direction} at (${Math.round(point.x)}, ${Math.round(point.y)}).`;
    } else {
      const result = await pageCall(tab.id, 'scroll', [{ direction, amount }]);
      if (result?.error) throw new ToolError(result.error, 'scroll_failed');
      output = result.output || `Scrolled ${direction}.`;
    }
    await hideIndicatorSoon(tab.id);
    if (isRecording(tab.id)) await recordFrame(tab.id);
    return {
      ok: true,
      name: 'computer',
      output,
      ...(await maybeTabContext(tab.id, ctx))
    };
  }

  if (action === 'hover') {
    const canDebug = await hasDebuggerPermission();
    await showIndicator(tab.id, 'Hovering…');
    if (input.ref) {
      const resolved = await pageCall(tab.id, 'resolve', [input.ref]);
      if (!resolved?.success) throw new ToolError(resolved?.error || 'Element not found.', 'ref_stale');
      await animate(ctx, tab.id, 'cursorTo', [
        resolved.x,
        resolved.y,
        { label: 'Hover' }
      ]);
      if (canDebug) {
        await cdpMoveMouse(tab.id, {
          x: resolved.x,
          y: resolved.y,
          modifiers: modifierMaskFromInput(input.modifiers)
        });
      } else {
        const result = await pageCall(tab.id, 'hover', [input.ref]);
        if (result?.error) throw new ToolError(result.error, 'hover_failed');
      }
    } else if (input.coordinate && canDebug) {
      const point = mapPoint(tab.id, input.coordinate);
      await animate(ctx, tab.id, 'cursorTo', [
        point.x,
        point.y,
        { label: 'Hover' }
      ]);
      await cdpMoveMouse(tab.id, {
        x: point.x,
        y: point.y,
        modifiers: modifierMaskFromInput(input.modifiers)
      });
    } else {
      throw new ToolError('hover needs a ref or coordinate.', 'missing_target');
    }
    await hideIndicatorSoon(tab.id);
    return {
      ok: true,
      name: 'computer',
      output: input.ref ? `Hovered ${input.ref}.` : 'Moved the pointer.',
      ...(await maybeTabContext(tab.id, ctx))
    };
  }

  if (action === 'left_click_drag') {
    if (!Array.isArray(input.start_coordinate) || !Array.isArray(input.coordinate)) {
      throw new ToolError(
        'left_click_drag needs start_coordinate and coordinate.',
        'missing_coordinates'
      );
    }
    const canDebug = await hasDebuggerPermission();
    if (!canDebug) {
      throw new ToolError(
        'Dragging needs trusted browser control. Enable it in Settings → Agent.',
        'debugger_required'
      );
    }
    const from = mapPoint(tab.id, input.start_coordinate);
    const to = mapPoint(tab.id, input.coordinate);
    await showIndicator(tab.id, 'Dragging…');
    await animate(ctx, tab.id, 'cursorTo', [
      from.x,
      from.y,
      { label: 'Drag' }
    ], 100);
    await cdpDrag(tab.id, {
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      modifiers: modifierMaskFromInput(input.modifiers)
    });
    await animate(ctx, tab.id, 'cursorTo', [
      to.x,
      to.y,
      { label: 'Drop' }
    ]);
    if (isRecording(tab.id)) await recordFrame(tab.id);
    await hideIndicatorSoon(tab.id);
    return {
      ok: true,
      name: 'computer',
      output: `Dragged from (${Math.round(from.x)}, ${Math.round(
        from.y
      )}) to (${Math.round(to.x)}, ${Math.round(to.y)}).`,
      ...(await maybeTabContext(tab.id, ctx))
    };
  }

  if (action === 'type') {
    const text = String(input.text ?? '');
    if (!text) throw new ToolError('type needs text.', 'missing_text');
    const canDebug = await hasDebuggerPermission();
    await showIndicator(tab.id, `Typing…`);
    let typePoint = null;
    if (input.ref) {
      const resolved = await pageCall(tab.id, 'resolve', [input.ref]);
      if (!resolved?.success) {
        throw new ToolError(resolved?.error || 'Element not found.', 'ref_stale');
      }
      typePoint = { x: resolved.x, y: resolved.y };
      await pageCall(tab.id, 'focus', [input.ref]);
    } else if (input.coordinate) {
      typePoint = mapPoint(tab.id, input.coordinate);
      if (canDebug) {
        await cdpClick(tab.id, { x: typePoint.x, y: typePoint.y });
      } else {
        await pageCall(tab.id, 'clickAt', [typePoint.x, typePoint.y, {}]);
      }
    }
    if (typePoint) {
      await animate(ctx, tab.id, 'cursorTo', [
        typePoint.x,
        typePoint.y,
        { label: 'Type' }
      ]);
      await animate(ctx, tab.id, 'typingAt', [typePoint.x, typePoint.y], 80);
    }
    if (canDebug) {
      await cdpInsertText(tab.id, text);
    } else {
      const result = await pageCall(tab.id, 'typeText', [text]);
      if (result?.error) throw new ToolError(result.error, 'type_failed');
    }
    await sleep(150);
    if (isRecording(tab.id)) await recordFrame(tab.id);
    await hideIndicatorSoon(tab.id);
    return {
      ok: true,
      name: 'computer',
      output: `Typed ${text.length} character${text.length === 1 ? '' : 's'}${
        input.ref ? ` into ${input.ref}` : ''
      }.`,
      ...(await maybeTabContext(tab.id, ctx))
    };
  }

  if (action === 'key') {
    const sequence = String(input.text || '').trim();
    if (!sequence) throw new ToolError('key needs text.', 'missing_text');
    const repeat = Math.max(1, Math.min(100, Number(input.repeat) || 1));
    const tokens = sequence.split(/\s+/).filter(Boolean);
    const canDebug = await hasDebuggerPermission();
    await showIndicator(tab.id, `Pressing ${truncate(sequence, 40)}…`);
    await animate(ctx, tab.id, 'keyPulse', [truncate(sequence, 18)]);
    for (let i = 0; i < repeat; i++) {
      for (const token of tokens) {
        if (canDebug) {
          await cdpPressKey(tab.id, token);
        } else {
          const result = await pageCall(tab.id, 'syntheticKey', [token]);
          if (result?.error) throw new ToolError(result.error, 'key_failed');
        }
      }
    }
    await sleep(200);
    if (isRecording(tab.id)) await recordFrame(tab.id);
    await hideIndicatorSoon(tab.id);
    return {
      ok: true,
      name: 'computer',
      output: `Pressed ${sequence}${repeat > 1 ? ` ${repeat} times` : ''}.`,
      ...(await maybeTabContext(tab.id, ctx))
    };
  }

  if (
    [
      'left_click',
      'right_click',
      'middle_click',
      'double_click',
      'triple_click'
    ].includes(action)
  ) {
    let point;
    let href = '';
    if (input.ref) {
      const resolved = await pageCall(tab.id, 'resolve', [input.ref]);
      if (!resolved?.success) {
        throw new ToolError(resolved?.error || 'Element not found.', 'ref_stale');
      }
      point = { x: resolved.x, y: resolved.y };
      href = resolved.href || '';
    } else if (input.coordinate) {
      point = mapPoint(tab.id, input.coordinate);
    } else {
      throw new ToolError('Click needs a ref or coordinate.', 'missing_target');
    }

    if (href && /^https?:/i.test(href)) {
      const targetHost = hostOf(href);
      if (targetHost && targetHost !== hostOf(tab.url)) {
        await authorizeDomain({
          ctx,
          url: href,
          toolName: 'navigate',
          input: { url: href },
          description: `clicking a link to ${targetHost}`
        });
      }
    } else if (href && /^\/\//.test(href)) {
      try {
        const absolute = new URL(href, tab.url).toString();
        const targetHost = hostOf(absolute);
        if (targetHost && targetHost !== hostOf(tab.url)) {
          await authorizeDomain({
            ctx,
            url: absolute,
            toolName: 'navigate',
            input: { url: absolute },
            description: `clicking a link to ${targetHost}`
          });
        }
      } catch {
        /* ignore malformed href */
      }
    }

    const before = new Set(
      (await summarizeTabs({ allWindows: false })).map((item) => item.id)
    );
    await showIndicator(tab.id, 'Clicking…');
    const canDebug = await hasDebuggerPermission();
    const clickCount =
      action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;
    const button =
      action === 'right_click'
        ? 'right'
        : action === 'middle_click'
          ? 'middle'
          : 'left';
    const modifiers = modifierMaskFromInput(input.modifiers);
    const clickLabel =
      action === 'right_click'
        ? 'Right click'
        : action === 'double_click'
          ? 'Double click'
          : action === 'triple_click'
            ? 'Triple click'
            : 'Click';
    await animate(ctx, tab.id, 'cursorTo', [
      point.x,
      point.y,
      { label: clickLabel }
    ], 120);
    if (canDebug) {
      await cdpClick(tab.id, {
        x: point.x,
        y: point.y,
        button,
        clickCount,
        modifiers
      });
    } else if (input.ref) {
      const result = await pageCall(tab.id, 'click', [
        input.ref,
        { button, clickCount, ...modifierFlags(input.modifiers) }
      ]);
      if (result?.error) throw new ToolError(result.error, 'click_failed');
    } else {
      const result = await pageCall(tab.id, 'clickAt', [
        point.x,
        point.y,
        { button, clickCount, ...modifierFlags(input.modifiers) }
      ]);
      if (result?.error) throw new ToolError(result.error, 'click_failed');
    }
    await animate(ctx, tab.id, 'clickPulse', [point.x, point.y]);
    await sleep(500);
    if (isRecording(tab.id)) await recordFrame(tab.id);
    const after = await summarizeTabs({ allWindows: false });
    const newTabs = after.filter((item) => !before.has(item.id));
    for (const item of newTabs) {
      if (ctx.settings.agent.groupTabs) {
        try {
          await addTabToGroup(item.id, ctx.groupId, true);
        } catch {
          /* best effort */
        }
      }
    }
    const newNote = newTabs.length
      ? ` A new tab opened: ${newTabs
          .map((item) => `[${item.id}] ${item.title || item.url}`)
          .join(', ')}.`
      : '';
    await hideIndicatorSoon(tab.id);
    const label =
      action === 'double_click'
        ? 'Double-clicked'
        : action === 'triple_click'
          ? 'Triple-clicked'
          : action === 'right_click'
            ? 'Right-clicked'
            : action === 'middle_click'
              ? 'Middle-clicked'
              : 'Clicked';
    return {
      ok: true,
      name: 'computer',
      output: `${label}${input.ref ? ` ${input.ref}` : ` at (${Math.round(point.x)}, ${Math.round(point.y)})`}.${newNote}`,
      data: { newTabs },
      ...(await maybeTabContext(tab.id, ctx))
    };
  }

  throw new ToolError(`Unsupported computer action: ${action}`, 'unsupported_action');
}

/* ------------------------------------------------------------------ */
/* Navigation & tabs                                                   */
/* ------------------------------------------------------------------ */

async function runWebFetch(input, ctx) {
  const raw = String(input.url || '').trim();
  if (!raw) throw new ToolError('web_fetch needs a URL.', 'missing_url');
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new ToolError(`"${raw}" is not a valid URL.`, 'bad_url');
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new ToolError('web_fetch only supports http(s) URLs.', 'bad_protocol');
  }
  url.username = '';
  url.password = '';
  await authorize({
    ctx,
    toolName: 'web_fetch',
    input,
    kind: TOOL_KIND.READ,
    url: url.toString()
  });
  const maxChars = Math.max(1000, Math.min(200000, Number(input.max_chars) || 50000));
  let response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      signal:
        typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? AbortSignal.timeout(20000)
          : undefined,
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5'
      }
    });
  } catch (error) {
    throw new ToolError(
      `Could not fetch ${url.hostname}: ${error instanceof Error ? error.message : error}`,
      'fetch_failed'
    );
  }
  if (!response.ok) {
    throw new ToolError(
      `Fetch failed (${response.status} ${response.statusText}) for ${url.hostname}.`,
      'fetch_failed'
    );
  }
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  let text = body;
  if (/html/i.test(contentType) || /^\s*<!doctype html/i.test(body)) {
    text = htmlToText(body);
  } else if (/json/i.test(contentType)) {
    try {
      text = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      text = body;
    }
  }
  text = text.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  const fullLength = text.length;
  if (text.length > maxChars) {
    const cut = text.lastIndexOf('\n', maxChars);
    text =
      text.slice(0, cut > 0 ? cut : maxChars) +
      `\n\n[output truncated at ${maxChars} of ${fullLength} characters]`;
  }
  return {
    ok: true,
    name: 'web_fetch',
    output: `URL: ${url.toString()}\nContent-Type: ${
      contentType || 'unknown'
    }\n---\n${text || '(empty response)'}`,
    data: { url: url.toString(), contentType, length: fullLength }
  };
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|main|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function runWebSearch(input, ctx) {
  const query = String(input.query || '').trim();
  if (!query) throw new ToolError('web_search needs a query.', 'missing_query');
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'rss');
  await authorize({
    ctx,
    toolName: 'web_search',
    input,
    kind: TOOL_KIND.READ,
    url: url.toString()
  });
  let response;
  try {
    response = await fetch(url.toString(), {
      credentials: 'omit',
      cache: 'no-store',
      signal:
        typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? AbortSignal.timeout(20000)
          : undefined,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, text/html',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
      }
    });
  } catch (error) {
    throw new ToolError(
      `Web search failed: ${error instanceof Error ? error.message : error}`,
      'search_failed'
    );
  }
  if (!response.ok) {
    throw new ToolError(`Web search returned ${response.status}.`, 'search_failed');
  }
  const body = await response.text();
  const results = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(body)) && results.length < 15) {
    const item = match[1];
    const title = xmlValue(item, 'title');
    const link = xmlValue(item, 'link');
    const description = xmlValue(item, 'description');
    if (!link) continue;
    results.push({
      title: htmlToText(title),
      url: decodeHtml(link),
      snippet: htmlToText(description)
    });
  }
  const limit = Math.max(1, Math.min(15, Number(input.limit) || 8));
  const out = results.slice(0, limit);
  if (!out.length) {
    return {
      ok: true,
      name: 'web_search',
      output: 'No search results were returned. Try a different query.',
      data: { results: [] }
    };
  }
  return {
    ok: true,
    name: 'web_search',
    output: out
      .map(
        (item, index) =>
          `${index + 1}. ${item.title}\n${item.url}\n${item.snippet}`
      )
      .join('\n\n'),
    data: { results: out }
  };
}

function xmlValue(xml, tag) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  if (!match) return '';
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

async function runNavigate(input, ctx) {
  const tab = await resolveTab(input.tabId, ctx);
  const target = String(input.url || '').trim();
  if (!target) throw new ToolError('navigate needs a URL.', 'missing_url');
  const resolvedUrl = /^(back|forward)$/i.test(target)
    ? tab.url
    : normalizeUrl(target);
  await authorize({
    ctx,
    toolName: 'navigate',
    input,
    kind: TOOL_KIND.ACT,
    url: resolvedUrl
  });
  if (!/^(back|forward)$/i.test(target)) {
    if (ctx.mode === 'auto') {
      await authorizeDomain({
        ctx,
        url: resolvedUrl,
        toolName: 'navigate',
        input,
        description: `navigating to ${hostOf(resolvedUrl)}`
      });
    }
  }
  await showIndicator(tab.id, 'Navigating…');
  const result = await navigateTab(tab.id, target);
  await hideIndicatorSoon(tab.id);
  if (isRecording(tab.id)) await recordFrame(tab.id);
  return {
    ok: true,
    name: 'navigate',
    output: `Navigated to ${result.title || result.url || resolvedUrl} (${
      result.url || resolvedUrl
    }).`,
    data: result,
    ...(await maybeTabContext(tab.id, ctx))
  };
}

async function runTabsContext(input, ctx) {
  const tabs = await summarizeTabs({ allWindows: input.all_windows !== false });
  const active = tabs.find((tab) => tab.id === Number(ctx.tabId));
  const lines = tabs.map(
    (tab) =>
      `- [${tab.id}]${tab.active ? ' (active)' : ''}${
        tab.groupId !== -1 ? ` group ${tab.groupId}` : ''
      } “${truncate(tab.title, 100)}” — ${truncate(tab.url, 300)}`
  );
  return {
    ok: true,
    name: 'tabs_context',
    output: `${
      active ? `Current tab: [${active.id}] ${active.title}\n` : ''
    }Available tabs (${tabs.length}):\n${lines.join('\n')}`,
    data: { tabs, currentTabId: ctx.tabId }
  };
}

async function runTabsCreate(input, ctx) {
  await authorizeSimple(ctx, 'tabs_create', input, 'open a new tab');
  const created = await createTab({
    url: input.url || 'about:blank',
    active: input.active !== false,
    groupId: ctx.groupId,
    groupTabs: ctx.settings.agent.groupTabs
  });
  if (created.groupId) ctx.groupId = created.groupId;
  return {
    ok: true,
    name: 'tabs_create',
    output: `Opened tab [${created.tabId}] ${created.title || created.url}.`,
    data: { newTabId: created.tabId, groupId: created.groupId },
    ...(await maybeTabContext(created.tabId, ctx))
  };
}

async function runTabsClose(input, ctx) {
  const tabId = Number(input.tabId || ctx.tabId);
  await authorizeSimple(ctx, 'tabs_close', input, 'close a tab');
  const closed = await closeTab(tabId);
  const remaining = await summarizeTabs({ allWindows: false });
  const next = remaining.find((tab) => tab.active) || remaining[0] || null;
  const contextTab = next?.id || ctx.tabId;
  return {
    ok: true,
    name: 'tabs_close',
    output: `Closed tab ${tabId}.`,
    data: { ...closed, nextTabId: next?.id || null },
    ...(await maybeTabContext(contextTab, ctx))
  };
}

async function runResize(input, ctx) {
  const width = Number(input.width);
  const height = Number(input.height);
  if (!width || !height) {
    throw new ToolError('resize_window needs width and height.', 'bad_size');
  }
  await authorizeSimple(ctx, 'resize_window', input, 'resize the window');
  const tab = await resolveTab(input.tabId, ctx);
  const result = await resizeWindow(tab.id, width, height);
  return {
    ok: true,
    name: 'resize_window',
    output: `Resized the window to ${result.width}×${result.height}.`,
    data: result
  };
}

/* ------------------------------------------------------------------ */
/* Console & network                                                   */
/* ------------------------------------------------------------------ */

async function runReadConsole(input, ctx) {
  const tab = await resolveTab(input.tabId, ctx);
  await authorize({
    ctx,
    toolName: 'read_console_messages',
    input,
    kind: TOOL_KIND.READ,
    url: tab.url
  });
  const result = await readConsoleMessages(tab.id, input);
  if (!result.messages.length) {
    return {
      ok: true,
      name: 'read_console_messages',
      output:
        'No console messages captured yet. The buffer starts when Myna attaches. Interact with the page, then read again.',
      data: result
    };
  }
  const lines = result.messages.map((entry) => {
    const at = entry.url
      ? ` (${entry.url}${entry.line !== undefined ? `:${entry.line}` : ''})`
      : '';
    return `[${entry.level}] ${stripAnsi(entry.text)}${at}`;
  });
  return {
    ok: true,
    name: 'read_console_messages',
    output: `Console messages (${result.messages.length} of ${result.captured}):\n${lines.join(
      '\n'
    )}`,
    data: result
  };
}

async function runReadNetwork(input, ctx) {
  const tab = await resolveTab(input.tabId, ctx);
  await authorize({
    ctx,
    toolName: 'read_network_requests',
    input,
    kind: TOOL_KIND.READ,
    url: tab.url
  });
  const result = await readNetworkRequests(tab.id, input);
  if (!result.requests.length) {
    return {
      ok: true,
      name: 'read_network_requests',
      output:
        'No network requests captured yet. The buffer starts when Myna attaches. Reload or interact with the page, then read again.',
      data: result
    };
  }
  const lines = result.requests.map(
    (req) =>
      `${req.method} ${req.status ?? '…'} ${req.type || ''} ${formatBytes(
        req.size
      )} ${req.durationMs}ms ${truncate(req.url, 500)}${
        req.failed ? ` [${req.failed}]` : ''
      }`
  );
  return {
    ok: true,
    name: 'read_network_requests',
    output: `Network requests (${result.requests.length} of ${result.captured}):\n${lines.join(
      '\n'
    )}`,
    data: result
  };
}

/* ------------------------------------------------------------------ */
/* Batch                                                               */
/* ------------------------------------------------------------------ */

async function runGifCreator(input, ctx) {
  const action = String(input.action || '').trim();
  const tab = await resolveTab(input.tabId, ctx);
  await authorize({
    ctx,
    toolName: 'gif_creator',
    input,
    kind: TOOL_KIND.ACT,
    url: tab.url
  });
  if (action === 'start_recording') {
    startRecording(tab.id);
    await recordFrame(tab.id);
    return {
      ok: true,
      name: 'gif_creator',
      output: 'GIF recording started. Perform actions, then stop and export.',
      data: { recording: true }
    };
  }
  if (action === 'stop_recording') {
    await recordFrame(tab.id);
    const state = await stopRecording(tab.id);
    return {
      ok: true,
      name: 'gif_creator',
      output: `GIF recording stopped with ${state.frames} frame${
        state.frames === 1 ? '' : 's'
      }.`,
      data: state
    };
  }
  if (action === 'clear') {
    clearRecording(tab.id);
    return { ok: true, name: 'gif_creator', output: 'GIF frames cleared.' };
  }
  if (action === 'export') {
    if (isRecording(tab.id)) await recordFrame(tab.id);
    const gif = await exportGif(tab.id);
    let download = null;
    if (input.download) {
      download = await downloadGif(
        gif,
        input.filename || `myna-recording-${Date.now()}.gif`
      );
    }
    return {
      ok: true,
      name: 'gif_creator',
      output: `Exported ${gif.frames} frames as a ${gif.width}×${gif.height} GIF${
        download ? ` and downloaded ${download.filename}` : ''
      }.`,
      images: [],
      displayImages: [
        {
          dataUrl: gif.dataUrl,
          mediaType: 'image/gif',
          width: gif.width,
          height: gif.height
        }
      ],
      data: { frames: gif.frames, download }
    };
  }
  throw new ToolError(`Unsupported GIF action: ${action}`, 'unsupported_action');
}

async function runBatch(input, ctx) {
  const actions = Array.isArray(input.actions) ? input.actions : [];
  if (!actions.length) {
    throw new ToolError('browser_batch needs at least one action.', 'empty_batch');
  }
  if (actions.length > MAX_BATCH_ACTIONS) {
    throw new ToolError(
      `browser_batch accepts at most ${MAX_BATCH_ACTIONS} actions.`,
      'batch_too_large'
    );
  }
  const results = [];
  const images = [];
  let stopped = false;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action || typeof action.name !== 'string') {
      results.push({ name: 'unknown', ok: false, error: 'Malformed action.' });
      stopped = true;
      break;
    }
    if (action.name === 'browser_batch' || action.name === 'update_plan') {
      results.push({
        name: action.name,
        ok: false,
        error: 'That tool cannot run inside browser_batch.'
      });
      stopped = true;
      break;
    }
    const result = await executeTool({
      name: action.name,
      input: action.input || {},
      context: {
        ...ctx,
        toolUseId: `${ctx.toolUseId || 'batch'}:${i}`,
        suppressTabContext: true
      }
    });
    results.push({
      name: action.name,
      ok: result.ok,
      output: result.ok ? result.output : undefined,
      error: result.ok ? undefined : result.error,
      data: result.ok ? result.data : undefined
    });
    if (result.data?.newTabId) ctx.tabId = result.data.newTabId;
    if (result.data?.tabId) ctx.tabId = result.data.tabId;
    if (result.images?.length) {
      for (const image of result.images) images.push(image);
    }
    if (!result.ok) {
      stopped = true;
      break;
    }
  }
  const ok = results.every((item) => item.ok);
  const summary = results
    .map(
      (item, index) =>
        `${index + 1}. ${item.name}: ${
          item.ok ? truncate(item.output || 'ok', 800) : `ERROR — ${item.error}`
        }`
    )
    .join('\n');
  return {
    ok,
    name: 'browser_batch',
    output: `Batch ${ok ? 'finished' : 'stopped'} (${results.length}/${
      actions.length
    } actions):\n${summary}`,
    images,
    data: { results, stopped },
    ...(await maybeTabContext(ctx.tabId, ctx))
  };
}

/* ------------------------------------------------------------------ */
/* JavaScript                                                          */
/* ------------------------------------------------------------------ */

async function runJavascript(input, ctx) {
  if (!ctx.settings.agent.javascriptTool) {
    throw new ToolError(
      'javascript_tool is turned off. Enable it in Settings → Agent if you really need it.',
      'javascript_disabled'
    );
  }
  if (input.action && input.action !== 'javascript_exec') {
    throw new ToolError("javascript_tool only supports action='javascript_exec'.", 'bad_action');
  }
  const code = String(input.text || '');
  if (!code.trim()) throw new ToolError('No JavaScript was provided.', 'missing_code');
  const tab = await resolveTab(input.tabId, ctx);
  await authorize({
    ctx,
    toolName: 'javascript_tool',
    input,
    kind: TOOL_KIND.ACT,
    url: tab.url
  });
  if (isRestrictedUrl(tab.url)) {
    throw new ToolError('JavaScript cannot run on browser-internal pages.', 'restricted_page');
  }
  const expression = `{${code}\n}`;
  let result = await sendCommand(tab.id, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    replMode: true,
    timeout: 10000
  });
  if (
    result?.exceptionDetails &&
    /Illegal return statement/i.test(
      result.exceptionDetails.exception?.description || ''
    )
  ) {
    result = await sendCommand(tab.id, 'Runtime.evaluate', {
      expression: `(async()=>{\n${code}\n})()`,
      returnByValue: true,
      awaitPromise: true,
      timeout: 10000
    });
  }
  if (result?.exceptionDetails) {
    const description =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      'Unknown JavaScript error';
    return {
      ok: false,
      name: 'javascript_tool',
      error: `JavaScript error: ${truncate(description, 2000)}`,
      errorCode: 'js_error'
    };
  }
  const value = sanitizeJsResult(result?.result);
  const output =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return {
    ok: true,
    name: 'javascript_tool',
    output:
      output && output.length > 50000
        ? `${output.slice(0, 50000)}\n[output truncated]`
        : output || 'undefined',
    data: { type: result?.result?.type }
  };
}

function sanitizeJsResult(remote) {
  if (!remote) return 'undefined';
  if (remote.type === 'undefined') return 'undefined';
  if (remote.type === 'object' && remote.subtype === 'null') return null;
  if (remote.type === 'function') return remote.description || '[Function]';
  if (remote.type === 'object') {
    if (remote.subtype === 'node') return remote.description || '[DOM Node]';
    return sanitizeValue(remote.value ?? remote.description, 0);
  }
  if (remote.value !== undefined) return sanitizeValue(remote.value, 0);
  return remote.description || String(remote.value);
}

const SENSITIVE_KEY_RE =
  /password|passwd|token|secret|api[_-]?key|auth|credential|private[_-]?key|access[_-]?key|bearer|oauth|session|cookie/i;

function sanitizeValue(value, depth) {
  if (depth > 5) return '[TRUNCATED: max depth]';
  if (typeof value === 'string') {
    if (value.includes('=') && /[;&]/.test(value)) return '[BLOCKED: cookie/query data]';
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
      return '[BLOCKED: JWT]';
    }
    if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(value)) return '[BLOCKED: base64 data]';
    if (/^[a-f0-9]{32,}$/i.test(value)) return '[BLOCKED: hex credential]';
    return value.length > 1000 ? `${value.slice(0, 1000)}[TRUNCATED]` : value;
  }
  if (Array.isArray(value)) {
    const out = value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
    if (value.length > 100) out.push(`[TRUNCATED: ${value.length - 100} more]`);
    return out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_RE.test(key)
        ? '[BLOCKED: sensitive key]'
        : sanitizeValue(item, depth + 1);
    }
    return out;
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

async function authorize({ ctx, toolName, input, kind, url }) {
  const host = hostOf(url);
  if (!host) {
    if (kind === TOOL_KIND.META) return { allowed: true };
    throw new ToolError(
      'No normal web page is attached. Open an http(s) page and try again.',
      'no_host'
    );
  }
  const decision = checkPermission({
    settings: ctx.settings,
    host,
    kind,
    toolName,
    mode: ctx.mode,
    approvedDomains: ctx.approvedDomains
  });
  if (decision.allowed) return { allowed: true };
  if (!decision.needsPrompt) {
    throw new ToolError(decision.reason || 'Permission denied.', 'permission_denied');
  }
  const response = await askUser({
    toolName,
    input,
    kind,
    host,
    url,
    summary: permissionRequestText({ toolName, input, host, kind }),
    sensitive: !!decision.sensitive,
    tabId: ctx.tabId,
    mode: ctx.mode
  });
  if (response.decision === 'deny' || response.closed) {
    throw new ToolError(
      'The user denied this action. Do not retry it. Ask how they would like to proceed.',
      'permission_denied'
    );
  }
  if (response.decision === 'allow_site') {
    const next = addSiteRule(
      ctx.settings,
      host,
      kind === TOOL_KIND.READ ? 'read' : 'act',
      'allow'
    );
    await saveSettings(next);
  }
  return { allowed: true, decision: response.decision };
}

async function authorizeDomain({ ctx, url, toolName, input, description }) {
  if (ctx.skipDomainConfirm) return { allowed: true };
  if (!ctx.settings.agent.confirmDomainChanges) return { allowed: true };
  const targetHost = hostOf(url);
  if (!targetHost) return { allowed: true };
  if (ctx.tabId) {
    try {
      const current = await getTab(ctx.tabId);
      const currentHost = normalizeHost(current.url || current.pendingUrl || '');
      const cleanTarget = normalizeHost(targetHost);
      if (
        currentHost &&
        (cleanTarget === currentHost || cleanTarget.endsWith(`.${currentHost}`))
      ) {
        return { allowed: true };
      }
    } catch {
      /* fall through to approval */
    }
  }
  if (isDomainApproved(targetHost, ctx.approvedDomains)) {
    return { allowed: true };
  }
  if (ctx.mode === 'plan') {
    throw new ToolError(
      `This action would leave the approved plan. Add ${targetHost} to a plan and get approval first.`,
      'plan_required'
    );
  }
  const response = await askUser({
    toolName,
    input,
    kind: TOOL_KIND.ACT,
    host: targetHost,
    url,
    summary: `Myna wants to continue by ${description || `visiting ${targetHost}`}.`,
    category: 'domain',
    tabId: ctx.tabId,
    mode: ctx.mode
  });
  if (response.decision === 'deny' || response.closed) {
    throw new ToolError(
      `The user did not approve visiting ${targetHost}. Do not retry this navigation.`,
      'domain_denied'
    );
  }
  if (response.decision === 'allow_site') {
    const next = addSiteRule(ctx.settings, targetHost, 'act', 'allow');
    await saveSettings(next);
  }
  return { allowed: true };
}

async function authorizeSimple(ctx, toolName, input, description) {
  if (ctx.mode === 'readonly') {
    throw new ToolError(
      'Myna is in Read only mode. Switch modes to allow this action.',
      'readonly'
    );
  }
  if (
    ctx.mode === 'plan' &&
    (!ctx.approvedDomains || ctx.approvedDomains.length === 0)
  ) {
    throw new ToolError(
      'This action is outside the approved plan. Call update_plan and wait for approval first.',
      'plan_required'
    );
  }
  if (ctx.mode !== 'ask') return { allowed: true };
  let host = 'browser';
  if (ctx.tabId) {
    try {
      const tab = await getTab(ctx.tabId);
      host = hostOf(tab.url || '') || 'browser';
    } catch {
      /* no tab */
    }
  }
  const response = await askUser({
    toolName,
    input,
    kind: TOOL_KIND.ACT,
    host,
    url: '',
    summary: `Myna wants to ${description}.`,
    category: 'simple',
    tabId: ctx.tabId,
    mode: ctx.mode
  });
  if (response.decision === 'deny' || response.closed) {
    throw new ToolError('The user denied this action.', 'permission_denied');
  }
  return { allowed: true };
}

function askUser(payload) {
  const requestId =
    globalThis.crypto?.randomUUID?.() ||
    `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.runtime
        .sendMessage({ type: 'myna.permission_timeout', requestId })
        .catch(() => {});
      resolve({ decision: 'deny', closed: true });
    }, 120000);
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value || { decision: 'deny' });
    };
    try {
      chrome.runtime.sendMessage(
        {
          type: 'myna.permission_request',
          requestId,
          ...payload
        },
        (response) => {
          if (chrome.runtime.lastError) {
            done({ decision: 'deny', closed: true });
          } else {
            done(response || { decision: 'deny' });
          }
        }
      );
    } catch {
      done({ decision: 'deny', closed: true });
    }
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function resolveTab(requestedTabId, ctx) {
  const id = Number(requestedTabId || ctx.tabId);
  if (!id) {
    throw new ToolError(
      'No tab is attached. Open a normal web page and try again.',
      'no_tab'
    );
  }
  let tab;
  try {
    tab = await getTab(id);
  } catch {
    throw new ToolError(
      `Tab ${id} no longer exists. Call tabs_context for fresh tab IDs.`,
      'tab_not_found'
    );
  }
  if (!tab) throw new ToolError(`Tab ${id} was not found.`, 'tab_not_found');
  if (isRestrictedUrl(tab.url || tab.pendingUrl)) {
    // Read/act tools will produce a clearer error via page injection, but fail
    // fast for navigation-only calls.
    if (!/^https?:/i.test(tab.url || '')) {
      throw new ToolError(
        `Myna cannot access ${tab.url || 'this page'}. Chrome blocks extensions on browser-internal pages.`,
        'restricted_page'
      );
    }
  }
  return tab;
}

async function pageInfoSafe(tabId) {
  try {
    return await pageCall(tabId, 'pageInfo', []);
  } catch {
    return null;
  }
}

async function showIndicator(tabId, label, options = {}) {
  try {
    await pageCall(tabId, 'indicator', [
      { show: true, label, ttl: 30000, ...options }
    ]);
  } catch {
    /* indicator is best-effort */
  }
}

async function hideIndicatorSoon(tabId) {
  setTimeout(() => {
    pageCall(tabId, 'indicator', [{ show: false }]).catch(() => {});
  }, 700);
}

async function hideIndicatorNow(tabId) {
  try {
    await pageCall(tabId, 'indicator', [{ show: false }]);
  } catch {
    /* best effort */
  }
}

async function animate(ctx, tabId, method, args = [], delay = 0) {
  if (!ctx.settings.agent.animations) return;
  try {
    await pageCall(tabId, method, args);
    if (delay) await sleep(delay);
  } catch {
    /* animations are cosmetic */
  }
}

async function maybeTabContext(tabId, ctx) {
  if (ctx.suppressTabContext) return {};
  try {
    return { tabContext: await tabContext(tabId, ctx.groupId) };
  } catch {
    return {};
  }
}

function normalizeUrl(value) {
  let target = String(value || '').trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    target = `https://${target.replace(/^\/+/, '')}`;
  }
  try {
    const url = new URL(target);
    if (!/^https?:$/.test(url.protocol)) {
      throw new Error('Only http(s) URLs are allowed.');
    }
    return url.toString();
  } catch (error) {
    throw new ToolError(
      `"${value}" is not a valid http(s) URL.`,
      'bad_url'
    );
  }
}

function mapPoint(tabId, coordinate) {
  const mapped = mapCoordinate(tabId, coordinate);
  if (!mapped) {
    throw new ToolError(
      'Coordinates must be [x, y] in the screenshot frame.',
      'bad_coordinates'
    );
  }
  return { x: mapped.x, y: mapped.y };
}

function modifierMaskFromInput(modifiers) {
  let mask = 0;
  const map = {
    alt: 1,
    ctrl: 2,
    control: 2,
    meta: 4,
    cmd: 4,
    command: 4,
    win: 4,
    windows: 4,
    shift: 8
  };
  for (const part of String(modifiers || '')
    .toLowerCase()
    .split('+')) {
    mask |= map[part.trim()] || 0;
  }
  return mask;
}

function modifierFlags(modifiers) {
  const lower = String(modifiers || '').toLowerCase().split('+');
  return {
    ctrlKey: lower.includes('ctrl') || lower.includes('control'),
    shiftKey: lower.includes('shift'),
    altKey: lower.includes('alt'),
    metaKey:
      lower.includes('cmd') ||
      lower.includes('meta') ||
      lower.includes('command') ||
      lower.includes('win') ||
      lower.includes('windows')
  };
}

function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
