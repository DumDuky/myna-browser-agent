/** Tool definitions exposed to models. */

import { MAX_BATCH_ACTIONS, TOOL_KIND } from './constants.js';
import { truncate } from './util.js';

const TAB_ID = {
  type: 'number',
  description:
    'Optional tab ID. Defaults to the tab this conversation is attached to. Use tabs_context to discover IDs.'
};

const COMMON = {
  type: 'object',
  properties: {
    tabId: TAB_ID
  }
};

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'read_page',
    kind: TOOL_KIND.READ,
    description:
      'Get an accessibility-tree view of the page with stable element references. Use this before clicking or filling anything. Returns roles, names, values, links, and [ref_N] IDs. Prefer refs over coordinates. Output is capped at max_chars.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['all', 'interactive'],
          description:
            'all (default) includes headings, text, and structure. interactive returns only actionable elements and their labels.'
        },
        depth: {
          type: 'number',
          description: 'Maximum tree depth (default 15, max 40).'
        },
        ref_id: {
          type: 'string',
          description:
            'Focus the tree on one element reference returned by a previous read_page or find call.'
        },
        max_chars: {
          type: 'number',
          description: 'Maximum characters to return (default 50000).'
        },
        tabId: TAB_ID
      }
    }
  },
  {
    name: 'get_page_text',
    kind: TOOL_KIND.READ,
    description:
      'Extract the readable text of the page, prioritizing article/main content. Use for reading and summarizing. Returns title, URL, source element, and plain text. Capped at max_chars.',
    inputSchema: {
      type: 'object',
      properties: {
        max_chars: {
          type: 'number',
          description: 'Maximum characters to return (default 50000).'
        },
        tabId: TAB_ID
      }
    }
  },
  {
    name: 'find',
    kind: TOOL_KIND.READ,
    description:
      'Find elements on the page by natural-language description or visible text, such as "search box", "add to cart", or "the price". Returns up to 20 matches with refs that can be used by computer and form_input.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What to find. Use quotes for exact visible text, e.g. "Sign in".'
        },
        tabId: TAB_ID
      },
      required: ['query']
    }
  },
  {
    name: 'form_input',
    kind: TOOL_KIND.ACT,
    description:
      'Set the value of a form control by element reference. Handles text inputs, textareas, selects, checkboxes, radios, contenteditable, date/time, number, and range inputs. Dispatches proper input and change events. Does not submit the form.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: 'Element reference from read_page or find, e.g. ref_12.'
        },
        value: {
          anyOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'number' }],
          description:
            'Value to set. Use a boolean for checkboxes, option value or visible text for selects.'
        },
        tabId: TAB_ID
      },
      required: ['ref', 'value']
    }
  },
  {
    name: 'file_upload',
    kind: TOOL_KIND.ACT,
    description:
      'Attach files that the user selected in the Myna composer to a file input on the page. The user must attach the files first. This uses a synthetic DataTransfer; some sites require a real file picker, so verify the upload before continuing.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description:
            'Element reference for an input[type=file], e.g. ref_7. Use read_page or find first.'
        },
        tabId: TAB_ID
      },
      required: ['ref']
    }
  },
  {
    name: 'computer',
    kind: TOOL_KIND.ACT,
    description:
      'Control the browser with mouse and keyboard. Take a screenshot first when using coordinates, or pass a ref from read_page/find instead. Coordinates are CSS pixels in the most recent screenshot frame. Click actions accept ref OR coordinate, not both. Use screenshot to see the page, type to enter text, and key for keys and shortcuts like "Enter" or "ctrl+a".',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'left_click',
            'right_click',
            'middle_click',
            'double_click',
            'triple_click',
            'type',
            'screenshot',
            'wait',
            'scroll',
            'key',
            'left_click_drag',
            'zoom',
            'scroll_to',
            'hover'
          ],
          description:
            'left_click, right_click, middle_click, double_click, triple_click, type, screenshot, wait, scroll, key, left_click_drag, zoom, scroll_to, or hover.'
        },
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
          description:
            '[x, y] in the screenshot coordinate frame. Required for scroll unless a ref is given. For drag, this is the end point.'
        },
        start_coordinate: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
          description: '[x, y] start point for left_click_drag.'
        },
        text: {
          type: 'string',
          description:
            'Text for type, or keys for key. For key, use space-separated keys and + for modifiers: "Enter", "Alt+Tab", "ctrl+a".'
        },
        duration: {
          type: 'number',
          minimum: 0,
          maximum: 10,
          description: 'Seconds to wait for the wait action (max 10).'
        },
        scroll_direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Direction for scroll.'
        },
        scroll_amount: {
          type: 'number',
          minimum: 1,
          maximum: 10,
          description: 'Wheel ticks for scroll (default 3).'
        },
        region: {
          type: 'array',
          items: { type: 'number' },
          minItems: 4,
          maxItems: 4,
          description: '[x0, y0, x1, y1] region for zoom.'
        },
        scale: {
          type: 'number',
          minimum: 0.1,
          maximum: 1,
          description:
            'Image scale for screenshot or zoom, 0.1–1. Coordinates still use the returned image frame.'
        },
        repeat: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Repeat count for key (default 1).'
        },
        ref: {
          type: 'string',
          description:
            'Element reference for clicks, hover, scroll, or scroll_to. Alternative to coordinate.'
        },
        modifiers: {
          type: 'string',
          description:
            'Click modifiers: ctrl, shift, alt, cmd/meta, win. Combine with +.'
        },
        tabId: TAB_ID
      },
      required: ['action']
    }
  },
  {
    name: 'navigate',
    kind: TOOL_KIND.ACT,
    description:
      'Navigate the current tab to a URL, or go back/forward in history. Use a full http(s) URL. After navigating, call read_page or get_page_text to inspect the new page.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Absolute URL, or "back" / "forward".'
        },
        tabId: TAB_ID
      },
      required: ['url']
    }
  },
  {
    name: 'web_fetch',
    kind: TOOL_KIND.READ,
    description:
      'Fetch an http(s) URL directly and return readable text without changing tabs. Useful for documentation, APIs, and pages you do not want to open. Does not execute page JavaScript and does not bypass authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL.' },
        max_chars: {
          type: 'number',
          description: 'Maximum characters to return (default 50000).'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'web_search',
    kind: TOOL_KIND.READ,
    description:
      'Search the public web with Bing RSS and return result titles, URLs, and snippets. Use web_fetch to read a result. This is a lightweight RSS search, not a licensed search API.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        limit: {
          type: 'number',
          description: 'Maximum results (default 8, max 15).'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'tabs_context',
    kind: TOOL_KIND.READ,
    description:
      'List the tabs available to this conversation with their IDs, titles, URLs, and group membership. Use before targeting a different tab. Includes every normal window by default.',
    inputSchema: {
      type: 'object',
      properties: {
        all_windows: {
          type: 'boolean',
          description: 'Include tabs from all normal browser windows.'
        }
      }
    }
  },
  {
    name: 'tabs_create',
    kind: TOOL_KIND.ACT,
    description:
      'Open a new tab, optionally at a URL, and make it the conversation tab. New tabs join the Myna tab group when grouping is enabled.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Optional URL. Defaults to a blank new tab.'
        },
        active: {
          type: 'boolean',
          description: 'Focus the new tab (default true).'
        }
      }
    }
  },
  {
    name: 'tabs_close',
    kind: TOOL_KIND.ACT,
    description:
      'Close a tab. Defaults to the current conversation tab. Refuses to close the last remaining tab.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: TAB_ID
      }
    }
  },
  {
    name: 'read_console_messages',
    kind: TOOL_KIND.READ,
    description:
      'Read recent console messages and uncaught errors from the tab. Requires the optional debugger permission for full fidelity. Pass a pattern to filter; without one, results may be noisy.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Case-insensitive substring or /regex/ filter.'
        },
        limit: {
          type: 'number',
          description: 'Maximum messages to return (default 100, max 500).'
        },
        clear: {
          type: 'boolean',
          description: 'Clear the buffer after reading.'
        },
        tabId: TAB_ID
      }
    }
  },
  {
    name: 'read_network_requests',
    kind: TOOL_KIND.READ,
    description:
      'Read recent HTTP requests from the tab: method, URL, status, type, size, and duration. Requires the optional debugger permission. Pass a pattern to filter.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Case-insensitive substring or /regex/ filter.'
        },
        limit: {
          type: 'number',
          description: 'Maximum requests to return (default 100, max 500).'
        },
        clear: {
          type: 'boolean',
          description: 'Clear the buffer after reading.'
        },
        tabId: TAB_ID
      }
    }
  },
  {
    name: 'resize_window',
    kind: TOOL_KIND.ACT,
    description:
      'Resize the browser window that contains the tab. Useful for responsive layouts and screenshots.',
    inputSchema: {
      type: 'object',
      properties: {
        width: { type: 'number', minimum: 320, maximum: 3840 },
        height: { type: 'number', minimum: 240, maximum: 2160 },
        tabId: TAB_ID
      },
      required: ['width', 'height']
    }
  },
  {
    name: 'gif_creator',
    kind: TOOL_KIND.ACT,
    description:
      'Record browser actions as an animated GIF. Start recording, perform actions, stop recording, then export. Frames are captured after actions at up to 40 frames. Export returns or downloads a GIF. Use download=true to save it to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start_recording', 'stop_recording', 'export', 'clear'],
          description: 'Recording action.'
        },
        download: {
          type: 'boolean',
          description: 'Download the GIF instead of only returning it.'
        },
        filename: {
          type: 'string',
          description: 'Optional filename for download.'
        },
        tabId: TAB_ID
      },
      required: ['action']
    }
  },
  {
    name: 'browser_batch',
    kind: TOOL_KIND.ACT,
    description:
      `Execute up to ${MAX_BATCH_ACTIONS} browser actions sequentially in one call. Use this for predictable sequences such as navigate → click → type → key → screenshot. Stops on the first error. Each action has the same shape as a standalone tool call. Cannot contain another browser_batch. Screenshots are returned in order.`,
    inputSchema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          maxItems: MAX_BATCH_ACTIONS,
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Tool name, e.g. computer, navigate, find.'
              },
              input: {
                type: 'object',
                description: 'That tool\'s input.'
              }
            },
            required: ['name', 'input']
          }
        }
      },
      required: ['actions']
    }
  },
  {
    name: 'update_plan',
    kind: TOOL_KIND.META,
    description:
      'Present or update a short plan. In plan-first mode this is required before acting; the user must approve the plan and the domains before tools run. Use 3–7 outcome-focused steps.',
    inputSchema: {
      type: 'object',
      properties: {
        domains: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Domains this plan will touch, e.g. ["github.com", "docs.github.com"].'
        },
        approach: {
          type: 'array',
          items: { type: 'string' },
          description: 'High-level steps, in order.'
        }
      },
      required: ['domains', 'approach']
    }
  },
  {
    name: 'javascript_tool',
    kind: TOOL_KIND.ACT,
    description:
      'Execute JavaScript in the page context and return the last expression. Powerful and risky. Only available when enabled in Settings. Prefer read_page, find, form_input, and computer. Never use it to read cookies, tokens, passwords, or credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['javascript_exec'],
          description: 'Must be javascript_exec.'
        },
        text: {
          type: 'string',
          description:
            'JavaScript with REPL semantics. Top-level await works. The last expression is returned.'
        },
        tabId: TAB_ID
      },
      required: ['action', 'text']
    }
  }
]);

export function getToolDefinitions({ javascriptTool = false } = {}) {
  return TOOL_DEFINITIONS.filter(
    (tool) => javascriptTool || tool.name !== 'javascript_tool'
  );
}

export function getToolDefinition(name) {
  return TOOL_DEFINITIONS.find((tool) => tool.name === name) || null;
}

export function toolKind(name) {
  const def = getToolDefinition(name);
  return def?.kind || TOOL_KIND.ACT;
}

export function summarizeToolCall(name, input = {}) {
  switch (name) {
    case 'read_page':
      return input.filter === 'interactive'
        ? 'Read page (interactive)'
        : 'Read page';
    case 'get_page_text':
      return 'Extract page text';
    case 'find':
      return input.query ? `Find “${truncate(input.query, 48)}”` : 'Find element';
    case 'form_input':
      return input.ref ? `Fill ${input.ref}` : 'Fill form field';
    case 'file_upload':
      return input.ref ? `Upload files to ${input.ref}` : 'Upload files';
    case 'navigate':
      return input.url ? `Go to ${truncate(input.url, 64)}` : 'Navigate';
    case 'web_fetch':
      return input.url ? `Fetch ${truncate(input.url, 64)}` : 'Fetch URL';
    case 'web_search':
      return input.query ? `Search “${truncate(input.query, 48)}”` : 'Web search';
    case 'tabs_context':
      return 'List tabs';
    case 'tabs_create':
      return input.url ? `Open tab ${truncate(input.url, 48)}` : 'New tab';
    case 'tabs_close':
      return 'Close tab';
    case 'read_console_messages':
      return 'Read console';
    case 'read_network_requests':
      return 'Read network';
    case 'resize_window':
      return `Resize to ${input.width}×${input.height}`;
    case 'update_plan':
      return 'Plan';
    case 'javascript_tool':
      return 'Run JavaScript';
    case 'browser_batch': {
      const count = Array.isArray(input.actions) ? input.actions.length : 0;
      return `Batch ${count} action${count === 1 ? '' : 's'}`;
    }
    case 'gif_creator':
      return `GIF ${input.action || 'record'}`;
    case 'computer': {
      const action = input.action || 'action';
      if (action === 'type') return `Type “${truncate(input.text || '', 40)}”`;
      if (action === 'key') return `Press ${truncate(input.text || '', 40)}`;
      if (action === 'screenshot') return 'Screenshot';
      if (action === 'scroll') return `Scroll ${input.scroll_direction || 'down'}`;
      if (action === 'wait') return `Wait ${input.duration || 0}s`;
      if (action === 'scroll_to') return 'Scroll to element';
      if (action === 'zoom') return 'Zoom screenshot';
      if (action === 'hover') return 'Hover';
      if (action === 'left_click_drag') return 'Drag';
      if (action.includes('click')) return 'Click';
      return `Browser ${action}`;
    }
    default:
      return name.startsWith('mcp__')
        ? `MCP: ${name.split('__').slice(2).join('__')}`
        : name;
  }
}
