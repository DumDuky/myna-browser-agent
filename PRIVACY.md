# Privacy

Myna has no server, no account, and no analytics. The extension is a local client that talks directly to the model provider you configure.

## What is stored

In `chrome.storage.local`:

- Provider profiles, including API keys unless a profile uses session-only keys
- Settings, permission modes, site rules, skills, custom instructions
- Chat history, including the page context that was sent with each turn
- The active chat ID

In `chrome.storage.session` (cleared when Chrome closes):

- API keys for profiles marked **Keep this key only until Chrome closes**

Myna does not store pages, screenshots, or console/network logs beyond the chat text you can see. Screenshot bytes are discarded when a chat is saved; older messages keep a placeholder count. MCP server headers may contain access tokens; they are stored with your local settings.

## What leaves your browser

Only the data you send to the provider you selected:

- Your messages
- The current tab's title, URL, viewport, and selected text (if enabled)
- Page content returned by read tools
- Screenshots, when the model asks for one and the provider accepts images
- Tool results such as console errors or network metadata

That data goes to the base URL in your active provider profile. Review your provider's privacy policy. If you use a local Ollama or LM Studio server, it stays on your machine or LAN.

## What does not happen

- No Myna account
- No Myna backend
- No telemetry or crash reporting
- No advertising identifiers
- No remote config
- No silent updates outside Chrome's extension update mechanism (and there is no update URL in this repository build)
- No data sale or sharing by the Myna project

## Permissions

- `<all_urls>`: required to read and act on the page in your current tab, and to let the user choose any site.
- `debugger` (optional): trusted input, screenshots, console, and network capture. You can revoke it at any time.
- `tabs`, `tabGroups`, `scripting`: tab listing, grouping, and the injected page agent.
- `storage`, `unlimitedStorage`: local settings and chat history.
- `sidePanel`: the chat UI.
- `contextMenus`: “Ask Myna about this selection” and page shortcuts.
- `webNavigation`: clear stale screenshot frames when a tab navigates.
- `alarms`: daily/weekly scheduled tasks.
- `notifications`: scheduled task results.
- `downloads`: GIF export when you choose download.

## Deleting data

Settings → Data lets you delete chats, delete keys, or reset everything. Uninstalling the extension removes its Chrome storage.

## Contact

Open an issue in the repository. Do not include API keys, private page content, or personal data in a public issue.
