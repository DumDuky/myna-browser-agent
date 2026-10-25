# Known limitations

This is the complete, current limitation list. If something is not here and it does not work, it is a bug.

Myna is an independent BYOK browser agent. It is not a full clone of Claude in Chrome or Claude Code, and it does not use their source code.

## Platform and distribution

- Chrome/Chromium only. No Firefox, Safari, or mobile Chrome.
- Requires Chrome 116+ for the Side Panel API.
- Load unpacked only. There is no signed CRX, Chrome Web Store listing, or auto-update channel in this repository.
- No enterprise policy, managed storage, organization controls, or admin console.
- No account system, cloud sync, team workspace, or license server.
- No i18n. The UI is English only.
- No RTL layout, high-contrast theme, or formal accessibility certification.
- No signed releases, update migration beyond the v1 settings schema, or support SLA. GitHub releases are source-built zips.
- No telemetry or crash reporting, which makes some bugs harder to diagnose.

## Provider and model

- API keys only. No OAuth flows, Google Vertex AI OAuth, AWS Bedrock SigV4, Azure AD, or client certificates.
- No model router, automatic fallback, automatic model selection, or cost-aware routing.
- No exact cost accounting. Token counts are provider-reported or estimated and can be wrong.
- No spend caps, budgets, or rate-limit queues. 429s surface as errors.
- Anthropic has no public model-list endpoint for browser clients; type the model ID.
- Model IDs in presets go stale. Always check the provider's current docs.
- OpenCode Go requires an active Go/Go Plus subscription and workspace key. Its model list, quotas, and endpoints are controlled by OpenCode and can change. The presets send an `x-opencode-session` header for routing; they are not an account or billing integration. Models served through OpenAI's Responses API (Grok 4.7, GPT Luna, Muse Spark), Google's native API (Gemini 4 Argon), or other wire formats need a matching adapter and are not suggested by the presets.
- Tool calling is required for browser actions. Text-only models can chat but cannot click or type.
- Image input is required for screenshots to be useful. Text-only profiles cannot see screenshots.
- Streaming can be disabled for gateways that reject SSE, but some gateways are still incompatible.
- Some OpenAI-compatible gateways reject `tools`, `tool_choice`, `max_tokens`, `max_completion_tokens`, `temperature`, images, or streaming. Myna surfaces the provider error; it does not guess a workaround.
- Some gateways mangle tool-call JSON, omit tool names, or send non-standard event shapes. Myna recovers common cases only.
- Anthropic prompt caching is optional and may be rejected by proxies.
- No extended-thinking parameter, no reasoning replay, and no guarantee that provider reasoning blocks are preserved.
- No provider-native web search, code interpreter, file search, computer-use API, or batch API.
- `web_search` uses Bing RSS search; it can be rate-limited, blocked, or broken by markup changes.
- No automatic retries with backoff.
- No local model runtime. Ollama/LM Studio must expose an OpenAI-compatible server.
- No proxy configuration UI. The browser's proxy settings apply.
- No custom CA or client-certificate configuration.
- Mixed HTTP/HTTPS provider endpoints work only within Chrome's extension CSP and network policy.

## Browser automation

- The side panel must stay open for normal chat runs. Closing it stops the conversation. Scheduled tasks use a separate runner window and also require Chrome to be running.
- Scheduled tasks are one-shot alarms, not a cloud cron. Chrome must be open, and a visible Myna window appears for each run.
- Scheduled tasks run in Auto-run. Sensitive-site prompts are denied because no side panel is open.
- No parallel scheduled runs and no retry policy beyond the next scheduled time.
- A scheduled run and an open side panel are not coordinated. Avoid pointing both at the same tab.
- No multi-agent orchestration, subagents, or handoffs.
- No desktop/OS automation. It cannot control native apps, the filesystem, or the terminal.
- No shell/terminal tool.
- No Python/Node sandbox. `javascript_tool` runs in the page, not in a safe runtime.
- No browser settings, history, bookmarks, downloads manager, password manager, or extension manager control.
- No cookie, `localStorage`, token, or credential access by design.
- File uploads use a synthetic `DataTransfer`; sites that require a trusted native picker may ignore them.
- Drag-and-drop file upload is not implemented.
- GIF recording stores frames in service-worker memory, caps at 40 frames / 640 px wide, and loses frames if the worker is terminated.
- GIF export can be slow and memory-heavy for large frame counts.
- No screenshots with annotations or drawing.
- No clipboard read. Copy buttons write to the clipboard.
- No voice input/output, audio capture, or screen sharing.
- No browser tab audio control.
- No printing, PDF export, or page-to-PDF.
- No automatic cookie banner acceptance, checkout, subscription, or legal-terms acceptance.
- No CAPTCHA solving, login-wall bypass, paywall bypass, age-gate bypass, or anti-bot evasion.
- No rate-limit or access-control bypass.
- No guarantee that sites will not detect automation.

## Page coverage

- `chrome://`, `edge://`, `about:`, `devtools://`, `view-source:`, the Chrome Web Store, and other protected pages are blocked by Chrome. Myna can open a normal tab from the restricted card, or do it automatically on send when **Open a new tab on protected pages** is enabled. It still cannot read the protected page itself.
- `file://` pages are treated as restricted. The extension will not read local files.
- Chrome's built-in PDF viewer is not controlled or read as a page.
- Cross-origin iframes are not traversed or controlled.
- Same-origin iframes are not a first-class target; only the top frame is used.
- Closed shadow roots are inaccessible.
- Open shadow roots are traversed, but some component libraries still behave poorly.
- Virtualized lists only expose rendered rows; scrolling may be required.
- Canvas, WebGL, image-only, and video-only pages have little or no DOM text. Screenshots plus a vision model may help; OCR is not built in.
- Pages that render slowly or stream forever may hit the navigation wait limit.
- Pages with aggressive CSP, sandboxing, or anti-extension defenses may block injection.
- Some sites detect synthetic DOM events. Trusted input via the debugger is more reliable but not universal.
- Some sites detect the debugger or show a banner.
- Coordinates drift after scrolling, layout shifts, zoom changes, or responsive reflow. Take a new screenshot.
- Screenshots are viewport-only. Full-page capture is not implemented.
- Background-tab screenshots require debugger access; otherwise Myna focuses the tab.
- Browser zoom and device-pixel-ratio differences are normalized only on a best-effort basis.
- Page text extraction prefers `article`/`main` and may include boilerplate or miss custom renderers.
- Accessibility trees exclude hidden nodes and may miss visual-only controls.
- `find` is local fuzzy matching, not semantic search. It can miss synonyms or return too many matches.
- The accessibility tree caps at 10,000 elements and 50,000 characters by default.
- Very large pages may need `filter="interactive"`, a smaller depth, or a `ref_id` focus.
- Element refs go stale after navigation or re-render. Re-read the page.
- Some custom widgets do not respond to DOM `click`, `input`, or `change` events.

## Permissions and safety

- Sensitive-host detection is a heuristic, not a complete list. It can miss a bank, payment, or government site.
- Site rules are host-based. Paths, subdomains with unusual layouts, and redirects are not modeled perfectly.
- Domain-transition checks use the link `href` when available. JavaScript-driven redirects and history navigation may cross domains before a prompt.
- The permission prompt has a 2-minute timeout that denies the action.
- If multiple side panels are open, a permission prompt can appear in more than one; the first response wins.
- “Always allow” rules are stored locally and can be overridden only in Settings → Permissions.
- Read-only mode still allows screenshots, page text, and console/network reads.
- Plan approval approves domains for the chat, not forever.
- A plan can be updated after approval without a new prompt.
- Prompt injection mitigation is instruction-level, not a hard security boundary. A malicious page can still influence a model.
- The JavaScript result sanitizer blocks common secret shapes, not every possible secret.
- Password, one-time-code, and card-field refusal is based on input type and autocomplete. Weird custom fields may slip through.
- Myna cannot guarantee that a form is safe, legally binding, or correct.
- Myna may make mistakes, click the wrong control, or misread a page.
- There is no human review layer, policy engine, or compliance certification.
- No audit log beyond the local chat history.
- No per-action approval for every keystroke; approvals are per tool call.
- No “dry run” mode that predicts all actions before executing.

## Context and conversation

- Context is trimmed by message units and characters. Old messages and images can be dropped mid-conversation.
- Only the newest `keepScreenshots` images are sent.
- Tool output is truncated at fixed caps. Large pages and network logs are lossy.
- No summarization/compaction strategy beyond trimming.
- No conversation branching, forking, or side-by-side compare.
- No message editing or regeneration. “Retry” only restores the last text to the composer.
- No search across chat history. The history drawer lists recent chats only.
- No projects, memory, knowledge base, or persistent user profile.
- Chat attachments are images and page-upload files. PDFs, DOCX, CSV, and audio are not extracted into chat context.
- No OCR for images.
- No background title generation; titles are the first user line.
- No automatic conversation export. Data export is JSON.
- No markdown image rendering in model output.
- No live artifacts/preview sandbox.
- No code execution or test runner for generated code.
- Chat history is capped at 100 sessions and strips image bytes.
- Session-only keys disappear when Chrome closes, by design.

## UI and interaction

- The composer sends with Enter by default; Shift+Enter adds a newline.
- The fixed shortcut is Ctrl/Cmd+E. It is not customizable.
- The side panel is controlled by Chrome's width constraints.
- The on-page cursor, click ripple, typing caret, keycap, and scroll hint are cosmetic and best effort.
- Animations can be disabled, and reduced-motion preferences suppress them.
- No custom themes beyond light/dark/system and comfortable/compact density.
- No drag-and-drop chat attachments.
- No paste-image-from-clipboard support.
- No inline image generation.
- No multi-language UI.
- No formal screen-reader or keyboard-only audit.
- The chat transcript is not printed/exported as Markdown from the UI.
- The history drawer does not paginate; it lists up to 100 chats.

## Security and privacy

- API keys are stored in Chrome local storage unless the profile is marked session-only.
- Chrome extension storage is not encrypted against a local attacker with access to your profile.
- Backup export includes saved API keys for non-session profiles. Treat backups as secrets.
- Session-only keys are stripped from backups, but non-session keys are not.
- No OS keychain, hardware token, or passphrase vault.
- No per-site or per-provider key isolation beyond separate profiles.
- No audit of provider logging, retention, or training policies.
- Page content and screenshots go to the provider you choose.
- No content redaction before sending to the model.
- The debugger permission exposes page console/network metadata and trusted input. Revoke it if you do not need it.
- Debugger attachment can conflict with DevTools or other extensions.
- Chrome shows a debugging banner while attached.
- No guarantee that “private” or “incognito” behavior matches your expectations; extension storage and provider requests still apply.
- No formal threat model review or third-party security audit.
- No bug bounty.

## Features intentionally not implemented

- Claude Desktop pairing, native messaging, and relayed inference
- MCP stdio servers, legacy HTTP+SSE transport, OAuth, sampling, and resources/prompts UI (remote Streamable HTTP tools only)
- MCP tools are fetched at the start of each chat; a slow or offline server delays the turn or is skipped with a toast.
- Claude Code integration
- Skills migration from Claude
- Saved prompt scheduling
- Shortcuts list/execute
- Provider-native web search
- Prompt library sync
- Organization/team policy
- Usage analytics
- Model marketplace

## Testing and support

- Unit tests cover SSE parsing, provider conversion, permissions, settings, message fitting, and tool schemas.
- Browser smoke tests are manual/local; CI runs unit tests and static checks only.
- No test matrix across every Chrome version, OS, or provider.
- No guarantee of parity with any version of Claude in Chrome or Claude Code.
- No support contract. Issues are best effort.
- No warranty. See `LICENSE`.
