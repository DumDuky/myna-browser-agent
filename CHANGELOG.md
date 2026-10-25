# Changelog

## 0.2.0 — 2026-10-25

- Provider, common-model, and behaviour presets
- OpenCode Go provider presets for both its OpenAI-compatible and Anthropic-compatible endpoints, with an `x-opencode-session` routing header
- Permission presets (Locked down, Ask first, Plan first, Autopilot)
- Appearance presets (Follow system, Paper, Midnight, Compact)
- Global side panel: one chat follows the active tab instead of a separate panel and session per tab
- Tabs context now includes every normal window by default
- Protected-page recovery: a configured start page opens in a new tab when Chrome blocks the current page, plus automatic mode on send
- Custom permission-mode menu and refreshed bird logo across the panel and settings
- Protected-page state now updates after navigating within the same tab, and long URLs wrap inside the notice card
- On-page animated cursor, click ripples, typing label, keycaps, scroll hints, and element flashes
- Remote MCP tools over Streamable HTTP
- Daily/weekly scheduled tasks with a runner window, local results, and notifications
- File uploads into page inputs via user-picked files
- Bing RSS `web_search` and direct `web_fetch`
- GIF recording and export with a vendored MIT encoder
- Full limitation list in `docs/limitations.md`
- Expanded browser smoke coverage for presets, animations, uploads, MCP, scheduler runner, and GIF export

## 0.1.0 — 2026-10-24

First public cut.

- Manifest V3 side panel with a local agent loop
- BYOK providers: Anthropic Messages and OpenAI-compatible
- Provider presets for Anthropic, OpenAI, Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Fireworks, Azure, Ollama, LM Studio, and custom gateways
- Local settings, session-only keys, chat history, markdown rendering
- Accessibility tree with stable refs, local find, page text, form filling
- Computer tool: click, type, key, scroll, hover, drag, screenshot, zoom, wait
- Tabs: list, create, close, group, navigate, resize
- Console and network tools via optional debugger
- Optional trusted input via CDP; DOM and visible-tab fallback
- Ask, auto-run, plan-first, and read-only modes
- Site rules, domain prompts, sensitive-host checks, password/payment refusal
- Plan approval card, permission card, tool cards, screenshot viewer
- On-page indicator
- Options page with profiles, agent settings, permissions, appearance, data export/import
- Unit tests and static checks
