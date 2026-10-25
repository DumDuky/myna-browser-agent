<p align="center">
  <img src="src/assets/icon-128.png" width="104" alt="Myna" />
</p>

<h1 align="center">Myna</h1>

<p align="center">
  <strong>An open-source Chrome browser agent with your own API keys.</strong><br />
  Read the page. Click, type, fill, scroll, open tabs, and research the web — without a Myna account or backend.
</p>

<p align="center">
  <a href="https://github.com/DumDuky/myna-browser-agent/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/DumDuky/myna-browser-agent?color=1f6f68" /></a>
  <a href="https://github.com/DumDuky/myna-browser-agent/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/DumDuky/myna-browser-agent/actions/workflows/ci.yml/badge.svg" /></a>
  <img alt="Chrome 116+" src="https://img.shields.io/badge/Chrome-116%2B-df9a31" />
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-1f6f68" />
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/github/license/DumDuky/myna-browser-agent?color=1f6f68" /></a>
  <img alt="No telemetry" src="https://img.shields.io/badge/telemetry-none-b4473c" />
</p>

<p align="center">
  <a href="https://github.com/DumDuky/myna-browser-agent/releases/latest"><strong>Download</strong></a>
  ·
  <a href="#install">Install</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="#providers">Providers</a>
  ·
  <a href="docs/limitations.md">Limitations</a>
  ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

![Myna chat side panel](docs/screenshots/chat.png)

Myna is an independent, clean-room Chrome extension inspired by the convenience of AI side panels such as Claude in Chrome. It is not affiliated with Anthropic. It talks directly to the model API you choose, keeps its state in your browser, and ships as readable source with no build step.

> **Status: beta.** The core agent works and is tested, but interfaces and provider presets can change. Read [limitations](docs/limitations.md) before trusting it with anything irreversible.

## Why Myna

- **Your key, your provider.** No Myna account, relay, or subscription. Use a frontier model, a cheap coding model, or a local Ollama model.
- **Local-first.** Chats, settings, rules, and keys live in Chrome storage. There is no Myna server and no telemetry.
- **Auditable.** No bundler, no minified code, no remote scripts. The whole extension is plain HTML, CSS, and ES modules.
- **One browser-wide chat.** Switch tabs and Myna follows the active tab; the conversation stays put. It can also list and work across tabs in every normal window.
- **Permission-first.** Ask first, auto-run, plan-first, or read-only. Sensitive sites prompt even in Auto-run, and password/card fields are refused.
- **Extensible.** Add remote MCP tools, scheduled runs, skills, and your own OpenAI-compatible gateway.

## Features

| | |
| --- | --- |
| **Browser tools** | Accessibility tree with stable refs, fuzzy find, article text, click/type/key/scroll/hover/drag, screenshots, form filling, file upload |
| **Tabs** | List tabs across windows, create, close, group, navigate, resize |
| **One global chat** | Follows the active tab without starting a new conversation per tab |
| **Providers** | Anthropic Messages and OpenAI Chat Completions, plus 15 presets |
| **Presets** | Provider, common model, behaviour, permission, and appearance presets |
| **Permissions** | Ask, Auto-run, Plan first, Read only; per-site rules; sensitive-host checks |
| **Agent motion** | Cursor, click ripples, typing caret, keycaps, scroll hints, element flashes |
| **MCP** | Remote Streamable HTTP servers, tools imported as `mcp__server__tool` |
| **Schedules** | Daily or weekly prompt runs in a visible window, with notifications |
| **Extras** | GIF recording/export, direct web fetch, Bing RSS search, skills editor |
| **Debugger (optional)** | Trusted input, full screenshots, console logs, network metadata |
| **Privacy** | No backend, no telemetry, session-only keys supported |

### Screenshots

| Agent presets | Permission presets |
| --- | --- |
| ![Agent presets](docs/screenshots/agent-presets.png) | ![Permission presets](docs/screenshots/permissions.png) |

| Appearance presets | MCP servers |
| --- | --- |
| ![Appearance presets](docs/screenshots/appearance.png) | ![MCP settings](docs/screenshots/mcp.png) |

## Install

### From a release

1. Open the [latest release](https://github.com/DumDuky/myna-browser-agent/releases/latest).
2. Download `myna-browser-agent-0.2.0.zip` and extract it.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked** and select the extracted `myna-browser-agent-0.2.0` folder.
6. Pin Myna to the toolbar.

### From source

```bash
git clone https://github.com/DumDuky/myna-browser-agent.git
cd myna-browser-agent
```

Then load the repository folder unpacked. There is no build step.

Chrome, Edge, Brave, and other Chromium browsers with the Side Panel API (Chrome 116+) are supported. Myna cannot read `chrome://`, the Chrome Web Store, the PDF viewer, or other protected pages. With **Open a new tab on protected pages** enabled, it can open a normal tab and work there instead.

## Connect a model

Open Settings and pick a provider preset, paste a key, and press **Save & start**.

| Provider | API shape | Example base URL | Notes |
| --- | --- | --- | --- |
| Anthropic | Messages | `https://api.anthropic.com` | Key from `console.anthropic.com` |
| OpenAI | Chat Completions | `https://api.openai.com/v1` | Any current chat model |
| OpenCode Go | OpenAI-compatible | `https://opencode.ai/inference/go/openai/v1` | Subscription key; DeepSeek, Kimi, GLM, MiMo, MiniMax 3.1 Flash |
| OpenCode Go (Anthropic) | Messages | `https://opencode.ai/inference/go/anthropic` | Subscription key; Qwen, MiniMax M3, Claude Haiku 5.5 |
| Google Gemini | OpenAI-compatible | `https://generativelanguage.googleapis.com/v1beta/openai` | Key from AI Studio |
| OpenRouter | OpenAI-compatible | `https://openrouter.ai/api/v1` | One key, many models |
| Groq | OpenAI-compatible | `https://api.groq.com/openai/v1` | Fast open models |
| DeepSeek | OpenAI-compatible | `https://api.deepseek.com` | `deepseek-chat` or `deepseek-reasoner` |
| Mistral | OpenAI-compatible | `https://api.mistral.ai/v1` | |
| xAI | OpenAI-compatible | `https://api.x.ai/v1` | |
| Together | OpenAI-compatible | `https://api.together.xyz/v1` | |
| Fireworks | OpenAI-compatible | `https://api.fireworks.ai/inference/v1` | |
| Azure OpenAI | OpenAI-compatible | `https://RESOURCE.openai.azure.com/openai/deployments/DEPLOYMENT` | Add `api-version=…` in the query field |
| Ollama | OpenAI-compatible | `http://localhost:11434/v1` | No key; pull a tool-capable model |
| LM Studio | OpenAI-compatible | `http://localhost:1234/v1` | No key; enable the local server |
| Custom | OpenAI-compatible | anything | Gateways, proxies, self-hosted |

The model must support **tool calling** for browser actions. Text-only models can chat and summarize, but cannot click or type. Model IDs move fast; every field is editable. See [docs/providers.md](docs/providers.md) for wire-format details.

### OpenCode Go

The **OpenCode Go** preset uses the OpenAI-compatible endpoint and defaults to `deepseek-v4.1-flash`. A second **OpenCode Go (Anthropic)** preset covers Qwen, MiniMax M3, and Claude Haiku 5.5 on the Messages endpoint. Both send a per-conversation `x-opencode-session` header for routing and cache affinity. Models served through OpenAI's Responses API or Google's native API need a matching adapter and are not suggested by the presets.

## Using Myna

Type a request in the side panel. Myna sees the active tab, can list every tab in the browser, and can act once you grant permission. One chat is global to the browser: switching tabs moves the page context, not the conversation. Click the context bar to re-sync it with the active tab.

Examples:

- “Summarize this page and list the decisions I need to make.”
- “Find the pricing table and compare the middle two plans.”
- “Fill in this form with the details below, but don't submit it.”
- “Open the docs in a new tab and find the authentication section.”
- “Read the console and tell me why the save button fails.”

### Modes

| Mode | What it means |
| --- | --- |
| **Ask first** | Prompts before reading a new site or taking an action. |
| **Auto-run** | Acts without prompts on approved sites. Sensitive sites and new domains still ask. |
| **Plan first** | Proposes a plan and domains. You approve; then it works autonomously on those domains. |
| **Read only** | Can inspect pages but cannot click, type, navigate, fill forms, or change tabs. |

### Protected pages

Chrome blocks extensions on `chrome://`, the Web Store, the PDF viewer, and similar pages. On one of those, the side panel offers **Open a normal tab**. With **Open a new tab on protected pages** enabled (Settings → Agent), sending a prompt does it automatically: Myna opens your configured start page, attaches to it, and runs the request there. The protected page itself is never read.

### MCP servers

Settings → MCP connects remote **Streamable HTTP** MCP servers. Add a name, URL, and optional headers. Myna calls `tools/list` at the start of each chat and exposes tools as `mcp__<server>__<tool>`. Stdio servers, legacy HTTP+SSE, OAuth, and a resources/prompts UI are not supported.

### Scheduled tasks

Settings → Scheduled adds daily or weekly runs. Chrome must be running. Each run opens a visible Myna window, uses Auto-run, records the result, and sends a notification. Sensitive-site prompts are denied because no side panel is open.

### Presets and motion

Settings → Providers has one-click provider presets and a common-model picker. Settings → Agent has four behaviour presets — **Cautious**, **Balanced**, **Agent**, and **Planner**. Settings → Permissions has **Locked down**, **Ask first**, **Plan first**, and **Autopilot**, which leave per-site rules untouched. Settings → Appearance has **Follow system**, **Paper**, **Midnight**, and **Compact**.

The on-page overlay is a real animation layer, not a screenshot decoration: a moving cursor with labels, click ripples, a typing caret, keycaps, scroll hints, and an element flash. It is cosmetic, can be disabled, respects `prefers-reduced-motion`, and is hidden before screenshots.

![On-page cursor and action hints](docs/screenshots/animations.png)

### Keys and privacy

- Keys are stored in `chrome.storage.local` by default.
- A profile can use **session-only keys** (`chrome.storage.session`), which disappear when Chrome closes.
- Keys are sent only to the provider base URL you configure.
- Myna has no telemetry, no relay, and no account system.
- See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Tools

Myna exposes a compact tool set. The model can call these through either provider format.

| Tool | Purpose |
| --- | --- |
| `read_page` | Accessibility tree with stable `ref_N` element IDs |
| `find` | Local fuzzy search over page elements, returns refs |
| `get_page_text` | Readable article/main text extraction |
| `computer` | Click, type, key, scroll, hover, drag, screenshot, zoom, wait |
| `form_input` | Set text, select, checkbox, radio, date, range, contenteditable |
| `file_upload` | Attach user-picked files to a page file input |
| `web_fetch` | Fetch an http(s) URL as readable text |
| `web_search` | Lightweight Bing RSS search |
| `gif_creator` | Record and export browser actions as a GIF |
| `navigate` | URL, back, forward |
| `tabs_context` | List tabs, IDs, groups, and windows |
| `tabs_create` / `tabs_close` | Open or close tabs, grouped when enabled |
| `read_console_messages` | Console and uncaught errors (debugger) |
| `read_network_requests` | HTTP request metadata (debugger) |
| `resize_window` | Responsive testing |
| `browser_batch` | Up to 12 tool calls sequentially in one round trip |
| `update_plan` | Plan approval and progress |
| `javascript_tool` | Off by default; page-context JavaScript |

See [docs/tools.md](docs/tools.md) for inputs and behaviour. Remote MCP tools are added dynamically as `mcp__<server>__<tool>`.

## How it works

```text
side panel ── provider API (your key, direct)
    │
    ├── agent loop (stream → tool calls → tool results → stream)
    │
    └── service worker
          ├── tab groups + tab lifecycle
          ├── page agent (injected, isolated world)
          │     ├── accessibility tree + refs
          │     ├── DOM form/click/type actions
          │     └── on-page indicator
          └── optional CDP bridge
                ├── trusted mouse/keyboard input
                ├── screenshots
                └── console/network capture
```

- No build step. The extension loads directly from source.
- The side panel owns the conversation and calls your provider directly.
- The service worker is the only place with privileged browser APIs.
- Page tools run in Chrome's isolated world through `chrome.scripting`.
- The side panel is global; per-tab panel documents and chats are intentionally not used.
- Content is never sent to a Myna server because there isn't one.

More detail: [docs/architecture.md](docs/architecture.md).

## Development

Requirements: Node 20+ for tests and static checks. No npm dependencies.

```bash
npm test        # unit tests (SSE, providers, permissions, settings, scheduler)
npm run check   # parse every script + validate manifest file references
npm run verify  # both
```

Then load the repository folder unpacked in `chrome://extensions`.

### Project layout

```text
.
├── manifest.json
├── src/
│   ├── background/      service worker, tabs, CDP, scheduler, tool executor
│   ├── lib/             providers, prompts, permissions, markdown, settings, MCP
│   ├── page/            injected page agent (tree, refs, actions)
│   ├── sidepanel/       chat UI and agent loop
│   ├── options/         provider, agent, permission, MCP, and data settings
│   ├── runner/          visible scheduled-task window
│   └── assets/          original Myna icon
├── tests/               Node test runner
├── docs/                architecture, tools, providers, limitations, releases
├── scripts/check.mjs    syntax + manifest validation
└── .github/             CI, release workflow, issue and PR templates
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Limitations

The full list is in [docs/limitations.md](docs/limitations.md). Highlights:

- Chrome/Chromium 116+ only. GitHub releases ship a zip, not a Chrome Web Store package, and there is no auto-update.
- Remote MCP only: Streamable HTTP, no stdio servers, legacy HTTP+SSE transport, OAuth flow, resources/prompts UI, or sampling.
- No Claude Desktop pairing, native messaging, relayed inference, or Claude Code integration.
- Scheduled tasks require Chrome to be running and open a visible window; no cloud cron and no sensitive-site prompts.
- File uploads use a synthetic `DataTransfer` and may be ignored by sites that require a real picker.
- GIF recording is capped at 40 frames / 640 px and lives in service-worker memory.
- Web search is lightweight Bing RSS search, not a licensed search API.
- No memory, projects, or multi-agent orchestration.
- No cross-origin iframe or closed-shadow-root control.
- No PDF viewer control, `file://` access, Chrome Web Store access, or browser-internal pages.
- No CAPTCHA, login-wall, paywall, or anti-bot bypass.
- Text-only models cannot use screenshots; tool calling is required for actions.
- Without the optional debugger, synthetic events can fail, and drag/console/network are unavailable.
- Sensitive-site detection and prompt-injection defenses are best effort, not guarantees.

Myna is not a pixel copy of Claude in Chrome or Claude Code, and it does not use their source code.

## Contributing

Issues and pull requests are welcome. Good first contributions: provider presets, documentation fixes, test coverage, accessibility, and small UI polish.

- Read [CONTRIBUTING.md](CONTRIBUTING.md).
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report vulnerabilities privately through [SECURITY.md](SECURITY.md).
- Use [SUPPORT.md](SUPPORT.md) for questions.

## Reverse-engineering note

[docs/reverse-engineering.md](docs/reverse-engineering.md) documents the architectural study of the original extension that informed this project. No proprietary source, assets, fonts, or copy were reused. Myna is an independent implementation with its own UI, prompts, code, and icon.

## Licence

MIT. See [LICENSE](LICENSE). Bundled third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Myna is not affiliated with Anthropic, Google, OpenAI, or any provider named in this repository. Provider names are trademarks of their respective owners.
