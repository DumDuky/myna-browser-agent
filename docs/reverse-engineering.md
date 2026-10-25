# Reverse-engineering notes

This document records the architectural study that informed Myna. It is a clean-room analysis of behavior and interfaces. No proprietary source code, assets, fonts, copy, or prompts were copied into this repository.

## REA evidence

The shipped package was analyzed with REA as an inert JavaScript application:

- Application analysis: `ev_ec8a91dba15d9381675fedfeb851ff2cb061b9a800a4f6559fe6d24ce38a6ae3`
- Summary view: `ev_dcd8ddae20cd460617dda81a4d60d3f915caa9fd0488a0fa0c6e3ac6025dcd97`
- Bundled MCP/permissions analysis: `ev_f44bd6ec1f80d62406a8051bfb663a2655e52833f8b3cccae1e1886963807ea9`

Coverage reported by REA:

- 6 selected JavaScript sources, 894,537 AST nodes, 1,575 findings, 0 parse failures
- 383 inventoried files outside the selected analysis scope
- Partial semantic graph: 4,555 call-flow, 21,912 closure, 13,899 data-flow, 1,522 object-flow relations retained; 70,030 semantic unknowns
- Electron/native-addon counts were zero; this is an extension bundle, not an Electron app
- REA did not execute the bundle; all relationships are static observations or conservative candidates

The feature inventory below combines that static evidence with the public Chrome APIs and manual runtime probes of the extension’s UI and tool contracts.

## Target

- Chrome extension package: `fcoeoabgfenejglbffodgkkbkcdhcgfn`, version `1.0.102`
- Name: “Claude” / “Claude in Chrome”
- Manifest V3, minimum Chrome 116
- Local unpacked artifact used only for observation

The analysis looked at:

- `manifest.json` and permission surface
- `sidepanel.html`, `options.html`, `offscreen.html`
- The service-worker bundle and tool registry
- The injected accessibility-tree script and visual indicator
- UI strings, tool schemas, and message rendering

## High-level findings

The original is a complete browser-agent product, not just a chat sidebar:

1. **Side panel UI** with conversation history, prompts, skills, scheduled tasks, and account state.
2. **Agent loop** in the side panel that calls Anthropic’s API directly with a tool list.
3. **Service worker** that owns tabs, tab groups, scripting, screenshots, console, network, downloads, and native messaging.
4. **Injected page agent** that builds an accessibility tree, assigns element references, and performs DOM actions.
5. **Bridge/native messaging** for Claude Desktop and MCP, plus a WebSocket bridge.
6. **Permission model** with read/action categories, site rules, plan approval, and domain transition prompts.
7. **Tab groups** named and colored for the agent session, with a visual indicator on pages.
8. **Screenshots and coordinates** with a coordinate frame and scaling.
9. **Scheduled tasks** that open a window, create a tab group, and run a prompt.
10. **GIF recording** with frame overlays and export.

Myna intentionally implements the core browser-agent loop and leaves the enterprise/desktop features out.

## Manifest surface

The original requests an unusually broad set:

- `sidePanel`, `storage`, `activeTab`, `scripting`, `debugger`
- `tabGroups`, `tabs`, `alarms`, `notifications`, `webNavigation`
- `declarativeNetRequestWithHostAccess`, `offscreen`, `nativeMessaging`
- `unlimitedStorage`, `downloads`, `identity`
- `<all_urls>` host permission
- externally connectable to `claude.ai`
- a managed storage schema and native messaging host names

Myna keeps the browser-agent essentials and makes `debugger` optional:

- required: `sidePanel`, `storage`, `activeTab`, `scripting`, `tabGroups`, `tabs`, `webNavigation`, `contextMenus`, `unlimitedStorage`
- optional: `debugger`
- host: `<all_urls>`

The original’s `identity`, `alarms`, `notifications`, `nativeMessaging`, `declarativeNetRequestWithHostAccess`, and `downloads` are not needed for a BYOK core.

## Page agent

The original injects `accessibility-tree.js` into all frames at `document_start`. It exposes a global tree generator that:

- Walks the DOM from `body` or a focused element
- Assigns `ref_N` IDs using a `Map` of `WeakRef`s and a reverse `WeakMap`
- Maps HTML tags to ARIA-like roles
- Skips hidden/offscreen nodes unless focused
- Redacts password values
- Emits lines like `role "name" [ref_N] href="..."`
- Caps elements (10,000) and output characters (50,000 by default)
- Returns viewport dimensions

Myna implements the same behavioral contract independently in `src/page/page-agent.js`, with some additions:

- Open shadow roots are traversed.
- The tree defaults to visible/semantic content and caps output the same way.
- `find` is local fuzzy search, not a second model call.
- Form filling uses native property setters and refuses password/payment fields.
- The indicator is Myna-branded and uses a shadow root.

## Tool set

The original registers these browser tools (names observed in the bundle):

`computer`, `read_page`, `find`, `form_input`, `get_page_text`, `navigate`, `tabs_context`, `tabs_create`, `tabs_close`, `read_console_messages`, `read_network_requests`, `resize_window`, `browser_batch`, `javascript_tool`, `update_plan`, `gif_creator`, `upload_image`/`file_upload`, `shortcuts_list`, `shortcuts_execute`, and `turn_answer_start`.

The tool descriptions emphasize:

- Consult a screenshot before clicking icons or visual layouts.
- Prefer refs over coordinates.
- Use `browser_batch` for predictable multi-step sequences.
- Ask for a valid tab ID from `tabs_context` first.
- Coordinates are in the screenshot frame.
- Read-only tools and action tools have different permission categories.

Myna implements the core set. `gif_creator`, uploads, shortcuts, and the internal `turn_answer_start` marker are omitted.

## Agent loop

The original loop:

1. Build a system prompt from remote config (`chrome_ext_system_prompt`, skip-permission variant, multi-tab variant).
2. Add platform hints and a `turn_answer_start` tool instruction.
3. Send messages plus tool schemas to Anthropic.
4. Stream text and tool-use blocks.
5. Execute tools through a central dispatcher.
6. Append tool results, including images and a tab-context system reminder.
7. Repeat until the model stops, the user stops, or a step cap is hit.
8. Generate a title in the background with a small model.

Myna mirrors the shape but uses a locally authored prompt:

- The system prompt is local and auditable.
- There is no remote prompt fetch.
- `turn_answer_start` is unnecessary because the UI renders text directly.
- Titles are derived from the first user message, avoiding an extra API call.
- Plan approval and permission prompts are handled in the side panel.

## Permission model

The original distinguishes permission categories (read page content, click, type, execute JavaScript, domain transition). It supports:

- `ask` mode with per-site “always allow”
- `skip_all_permission_checks` / `follow_a_plan` modes
- plan approval that approves a set of domains
- a domain-transition prompt when a navigation would cross hosts
- sensitive-site / category filtering by a remote service
- managed-organization policies

Myna keeps the useful parts:

- `ask`, `auto`, `plan`, `readonly`
- read vs act categories
- per-host rules and “always allow on this site”
- domain transition prompts
- plan approval that adds domains for the session
- local sensitive-host heuristics (banking, payments, government)
- a hard refusal for password/one-time-code/card fields

It does not have remote category filtering or organization policy.

## Tab groups and indicator

The original groups agent tabs, colors and titles the group, and injects a visual indicator. It uses the group as a session boundary and has logic for main/secondary tabs, closed tabs, and tab group changes.

Myna groups tabs when enabled, titles the group “Myna” in yellow, and uses a lightweight indicator with a frame, status pill, click flash, and cursor dot. It does not implement the original’s multi-tab session protocol.

## Screenshots

The original has a sophisticated screenshot pipeline:

- debugger `Page.captureScreenshot`
- coordinate contexts and device-pixel-ratio handling
- clip/zoom regions
- coordinate mapping across screenshots
- screenshot IDs and image storage for the model
- special handling for background tabs and pending navigation

Myna implements a smaller version:

- CDP screenshot with a CSS-pixel clip when debugger access is granted
- visible-tab screenshot fallback
- normalization to a configured max width
- a per-tab coordinate frame that maps image pixels back to CSS pixels
- zoom regions
- screenshots omitted from saved chats to keep storage small

## Console and network

The original reads console and network data through the debugger and filters by domain. It clears buffers on navigation.

Myna attaches on demand, enables `Runtime`, `Log`, and `Network`, keeps 500-entry ring buffers, and clears network records when the document host changes.

## Native messaging / MCP

The original pairs with Claude Desktop and Claude Code over native messaging, supports MCP servers, sealed pairing handshakes, organization policy, and relayed inference. That is a substantial enterprise/desktop subsystem.

Myna does not implement native messaging, MCP, or relayed inference. It is deliberately a standalone BYOK browser agent.

## Scheduled tasks / skills / prompts

The original supports saved prompts, scheduled tasks via alarms, skill migration, and a background window runner. Myna adds local skills, daily/weekly alarms, a runner page, and remote MCP tools. It does not migrate Claude skills or schedule cloud-side jobs.

## UX observations

The original side panel prioritizes:

- A warm, editorial visual system
- A persistent current-tab chip
- Inline tool cards with running/done/error states
- Screenshot thumbnails inside tool cards
- Plan and permission cards near the composer
- A visible mode switch and model indicator
- A stop control during a run
- Token/usage feedback
- A history drawer
- Setup/onboarding for account and model

Myna follows those interaction patterns with an original visual system, typography, icon, and copy.

## Deliberate differences

| Area | Original | Myna |
| --- | --- | --- |
| Account | Anthropic account | None |
| Model | Anthropic models | Any BYOK provider |
| Backend | Anthropic API + bridge | Direct provider only |
| Prompts | Remote config | Local, auditable |
| MCP/Desktop | Yes | Remote Streamable HTTP MCP; no desktop stdio |
| Scheduled tasks | Yes | Yes, daily/weekly alarms with a runner window |
| GIF recording | Yes | Yes, 40 frames / 640 px |
| File upload | Yes | Best-effort synthetic DataTransfer |
| Debugger | Required permission | Optional, with DOM fallback |
| Telemetry | Product analytics | None |
| Licence | Proprietary | MIT |

## Clean-room statement

The implementation was written from observed behavior and public web-platform APIs. No proprietary source code, assets, fonts, copy, or prompts were copied or republished. Tool names and protocol shapes are functional interfaces; the code, prompts, visual design, icons, and documentation here are original.

If you maintain the original project and believe something here crosses a line, open an issue and it will be addressed.
