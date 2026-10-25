# Security

Myna is a browser agent. It can read pages, click, type, and use an optional debugger. Treat it like a capable assistant with access to your browser session.

## Design choices

- **No backend.** API keys and conversations go directly from the extension to the provider you configure. There is no Myna relay.
- **No remote code.** All scripts ship in the extension. The manifest CSP allows only `'self'` scripts. Provider endpoints are the only network destinations.
- **Isolated page agent.** DOM tools run in Chrome's isolated world through `chrome.scripting`, not as a page script. Page content cannot call `window.__myna` unless it reaches the isolated world (it does not).
- **Least privilege by default.** Read and action permissions are separate. Sensitive hosts prompt even in Auto-run. Passwords, one-time codes, and card fields are refused.
- **Optional debugger.** The `debugger` permission is optional and can be revoked in Settings → Permissions. Myna attaches for a run and detaches afterwards.
- **JavaScript tool off by default.** `javascript_tool` is only advertised to the model when you explicitly enable it.
- **Prompt injection guard.** The system prompt tells the model that page content is untrusted and never instructions. This reduces risk; it does not eliminate it.

## Known risks

- **Prompt injection.** A page can contain text designed to manipulate the model. Myna is instructed to ignore it, but no LLM is immune. Keep the approval mode on for sensitive work.
- **API keys in local storage.** Chrome extensions cannot securely encrypt secrets against a local attacker. Use session-only keys or a provider key with a low spending limit.
- **Third-party providers.** Your page content and messages go to the provider. Use a provider you trust. Local models avoid this entirely.
- **MCP servers.** Remote MCP tools execute on the server you configure. Review the server, its tools, and its headers. Auto-run allows MCP calls without a prompt.
- **Scheduled tasks.** They run in Auto-run in a visible window and deny sensitive-site prompts. Do not schedule tasks that need interactive approval.
- **File uploads.** Uploaded files are read into extension memory and sent to the page. Do not attach confidential files to untrusted sites.
- **GIF frames.** Recorded frames stay in service-worker memory until cleared or the worker stops.
- **Agent mistakes.** The model can click the wrong thing or misread a page. Confirm irreversible actions and review forms before submission.
- **Debugger banner.** Chrome displays a debugging banner while trusted control is active. This is expected.

## Hard blocks

Myna refuses to:

- Type into password, hidden, one-time-code, or payment-card fields
- Bypass login walls, paywalls, CAPTCHAs, or access controls
- Read cookies or credentials through the JavaScript tool
- Return obvious secrets (JWTs, base64 blobs, cookie strings) from JavaScript results
- Act on sensitive financial/government sites without a fresh approval

## Supported versions

Security fixes target the latest GitHub release and `main`. Older tags are not maintained.

## Reporting a vulnerability

Please use [private vulnerability reporting](https://github.com/DumDuky/myna-browser-agent/security/advisories/new). Do not open a public issue or publish exploit details before a fix is available. Include:

- Extension version and browser version
- A minimal reproduction
- Impact and affected files
- Whether the debugger permission was granted

If private reporting is unavailable, open a minimal issue asking for a private channel without including exploit details.

## What we will not do

- Add analytics that collect page content
- Add a server-side proxy for keys
- Ship obfuscated code
- Ask for your API key in an issue
