# Architecture

Myna is a Manifest V3 Chrome extension with three runtime surfaces:

1. **Side panel** — conversation UI and agent loop
2. **Service worker** — privileged browser tools, tabs, optional CDP
3. **Page agent** — injected DOM reader/actor in Chrome's isolated world

There is no build step and no backend.

The side panel uses a single global path (no per-tab URL). The conversation is global to the browser; `tabs.onActivated` updates the attached tab and context, while the chat stays in place. Per-tab side-panel options are not used, because they would give each tab a separate panel document and chat state.

## Message flow

```
user text
   │
   ▼
side panel: build system prompt + tab context
   │
   ▼
provider adapter: POST /v1/messages or /chat/completions
   │  stream text / tool calls
   ▼
agent loop
   │  tool call
   ▼
service worker: permission check → execute
   │
   ├── page agent (read/click/type/form)
   ├── tabs API (create/close/group/navigate)
   └── optional CDP (trusted input, screenshots, console/network)
   │
   ▼
tool result → provider adapter → next stream
```

The side panel owns the loop. Closing it stops the current run. The service worker is stateless between calls except for caches: CDP buffers, screenshot frames, and tab groups.

## Modules

| Path | Responsibility |
| --- | --- |
| `src/lib/constants.js` | Presets, modes, defaults, storage keys |
| `src/lib/settings.js` | Deep merge, profile normalization, local/session key storage |
| `src/lib/providers/` | Anthropic and OpenAI adapters, SSE parser, shared auth |
| `src/lib/prompt.js` | System prompt and per-turn tab context |
| `src/lib/tools-schema.js` | Tool JSON schemas and UI summaries |
| `src/lib/permissions.js` | Pure permission decisions and site rules |
| `src/lib/markdown.js` | Safe Markdown renderer (no raw HTML) |
| `src/lib/mcp.js` | Remote MCP Streamable HTTP client |
| `src/lib/image.js` | Screenshot normalization for workers |
| `src/background/service-worker.js` | Messages, side panel, context menus, tab events |
| `src/background/tabs.js` | Tab lifecycle, grouping, page-agent injection |
| `src/background/tool-executor.js` | Tool implementations and approval flow |
| `src/background/cdp.js` | Optional debugger: input, screenshots, console, network |
| `src/background/screenshots.js` | Capture, scale, coordinate frames |
| `src/background/gif-recorder.js` | Frame capture, GIF encoding, download |
| `src/background/scheduler.js` | Alarms, next-run math, task runner windows |
| `src/runner/` | Headless-ish scheduled task page |
| `src/vendor/gifenc.js` | MIT GIF encoder |
| `src/page/page-agent.js` | Accessibility tree, refs, DOM actions, indicator |
| `src/sidepanel/agent.js` | Agent loop, history fitting, plan handling |
| `src/sidepanel/main.js` | UI state, sessions, permissions, composer |
| `src/sidepanel/components.js` | Messages, tool cards, plan card, setup |
| `src/options/` | Provider, agent, permission, data settings |

## Provider abstraction

The internal message format is provider-neutral:

```js
{ role: 'user', content: '...', images: [dataUrl] }
{ role: 'assistant', content: '...', toolCalls: [{ id, name, input }] }
{ role: 'tool', toolCallId, name, content, isError, images: [dataUrl] }
```

Each adapter converts to its wire format:

- **Anthropic**: `system` blocks, `tool_use` / `tool_result` content, `input_schema`, SSE events.
- **OpenAI-compatible**: `system` role, `tool_calls` on assistant messages, `role: 'tool'` results, function tools.

Images are supported in both formats when the profile says `supportsImages`. For text-only models, images are replaced with a note.

## Permissions

A pure function makes the decision:

```js
checkPermission({ settings, host, kind, toolName, mode, approvedDomains })
  → { allowed, needsPrompt, denied, reason }
```

- **Ask**: prompt for read and act unless a site rule or approved domain says otherwise.
- **Auto**: allow, but prompt for sensitive hosts and new domains.
- **Plan**: read is allowed; act requires a domain approved by `update_plan`.
- **Read only**: act is denied.

When a prompt is needed, the service worker sends `myna.permission_request` to the side panel and waits. The side panel renders the card and resolves the message channel with `allow`, `allow_site`, or `deny`. A 2-minute timeout denies.

Site rules live in `settings.permissions.rules`. A rule on `example.com` covers `www.example.com`.

## Page agent

`page-agent.js` is injected with `chrome.scripting.executeScript` into the isolated world. It is idempotent and keeps:

- `refs: Map<ref, WeakRef<Element>>`
- `reverse: WeakMap<Element, ref>`

The accessibility tree assigns `ref_N` to interactive and semantic nodes, includes open shadow roots, and formats roles, names, values, state, and links. `resolveRef` scrolls the element into view and returns its center. `formInput` uses native property setters so React/Vue-style controlled inputs see the change. Password, one-time-code, and payment fields are refused.

The page agent also owns the on-page indicator: a subtle frame, a “Myna is working…” pill, a moving cursor with action labels, click ripples, typing labels, keycaps, scroll hints, and element flashes. It is visual only, uses `pointer-events: none`, and is suppressed before screenshots. The `animations` setting can turn it off.

## Trusted input vs DOM fallback

Without the optional debugger permission:

- Clicks and typing use DOM events and native setters.
- Screenshots use `chrome.tabs.captureVisibleTab` and are normalized.
- Console/network tools return a friendly “enhanced access is off” error.
- Drag is unavailable.

With the debugger permission:

- Mouse and keyboard events use `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `Input.insertText`.
- Screenshots use `Page.captureScreenshot` with a CSS-pixel clip.
- Console and network buffers are captured through `Runtime`, `Log`, and `Network`.
- Screenshot coordinates are mapped from the returned image frame to CSS pixels.

The service worker attaches on demand and detaches when the run ends.

## MCP servers

Settings → MCP accepts remote Streamable HTTP servers. At the start of a chat, `loadMcpTools` initializes each server, calls `tools/list`, and adds prefixed tools (`mcp__<serverId>__<tool>`). The agent handles those calls in the side panel, asks for permission outside Auto-run, and converts `content` blocks (text, images, resources) into tool results. Stdio MCP requires a native host and is not supported.

## Scheduled tasks

Tasks are stored in settings. `scheduler.js` creates one-shot `chrome.alarms` for daily/weekly runs. When an alarm fires, the service worker opens a normal window with `src/runner/index.html`. The runner opens the task URL, builds a context, runs the same `runAgent` loop in Auto-run, records the final text or error, notifies the user, and closes the window. `skipDomainConfirm` is set for scheduled runs; sensitive-site prompts are denied because the runner cannot show a permission card.

## File uploads and GIFs

The composer's **Files** button stores up to four 5 MB files as data URLs. `file_upload` passes those bytes to the injected page agent, which builds a `DataTransfer` and sets `input.files`. This is synthetic, so a real picker may be required by some sites.

`gif_creator` records frames after computer/navigate/form actions while a recording is active. Frames are capped at 40 and 640 px wide, then encoded with the vendored MIT `gifenc` build. GIF bytes are shown in the tool card but are not sent to the model.

## Context management

The side panel sends the current tab title, URL, viewport, selected text, and open tabs as a `<system-reminder>` before the user request. Page content returned by tools is separate. Before each model call, `fitMessages`:

- Groups assistant + tool messages so a tool result is never orphaned.
- Keeps the most recent units within `maxHistoryMessages` and `maxContextChars`.
- Keeps only the newest `keepScreenshots` images.
- Drops old screenshots but keeps their text.

## Storage

| Key | Contents |
| --- | --- |
| `myna.settings.v1` | Profiles, agent settings, permissions, UI, skills |
| `myna.sessions.v1` | Up to 100 chat sessions, images stripped |
| `myna.activeSession.v1` | Active chat ID |
| `myna.sessionSecrets.v1` | Session-only API keys (session storage) |
| `myna.pendingPrompt.v1` | Context-menu handoff |

Session-only keys are never written to local storage.

## CSP and network

The extension page CSP allows scripts only from the extension and network requests to `https:` and `http:` hosts. This is necessary for bring-your-own-key gateways and local models. Keys are sent only to the configured base URL. There is no remote script loading.

## Failure handling

- Provider errors include status and message with hints for 401/404/429/5xx.
- Screenshot capture falls back from CDP to the visible tab.
- Page injection failures produce a “Chrome blocks this page” message.
- Permission denial becomes a tool error the model can read and adapt to.
- Stopping aborts the fetch, denies pending prompts, and cancels a pending plan.
- Chat saves are debounced and strip large binary data.
