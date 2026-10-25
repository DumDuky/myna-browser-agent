# Tool reference

All tools take an optional `tabId`. When omitted, they use the active tab Myna is attached to. The model is told to call `tabs_context` if it needs a different tab. `tabs_context` lists all normal browser windows by default; pass `all_windows: false` to limit it to the current window.

The tool schemas in `src/lib/tools-schema.js` are the source of truth.

## `read_page`

```json
{ "filter": "all|interactive", "depth": 15, "ref_id": "ref_12", "max_chars": 50000 }
```

Returns a tree:

```
heading "Myna Test Page" [ref_1]
form [ref_3]
  textbox "Your name" [ref_5]
  combobox "Favorite color" [ref_7] value="Teal"
  checkbox "I agree" [ref_9] type="checkbox"
  button "Submit" [ref_10]
```

- `all` includes headings, text, and structure.
- `interactive` returns actionable elements and their labels.
- `ref_id` focuses the tree on a subtree.
- Output is capped at `max_chars` and 10,000 elements.
- Refs are stable until the element is removed or the page navigates.

## `find`

```json
{ "query": "add to cart button" }
```

Local fuzzy search over the page. Returns up to 20 refs with role, name, tag, and a match reason. No extra model call is involved. Quote a string for exact visible text: `"Sign in"`.

## `get_page_text`

```json
{ "max_chars": 50000 }
```

Selects the largest likely article/main container, falls back to `body`, normalizes whitespace, and returns title, URL, source element, and plain text.

## `form_input`

```json
{ "ref": "ref_12", "value": "Ada Lovelace" }
```

Supports:

- text, email, search, URL, tel, password, hidden (password/hidden are refused)
- textarea
- select by option value or visible text
- checkbox (boolean)
- radio
- date, time, datetime-local, month, week
- range, number
- contenteditable

It dispatches `input` and `change`. It does not submit.

## `computer`

```json
{ "action": "left_click", "ref": "ref_10" }
{ "action": "left_click", "coordinate": [100, 200] }
{ "action": "screenshot" }
{ "action": "type", "ref": "ref_5", "text": "hello" }
{ "action": "key", "text": "Enter" }
{ "action": "key", "text": "ctrl+a" }
{ "action": "scroll", "scroll_direction": "down", "scroll_amount": 3 }
{ "action": "wait", "duration": 2 }
{ "action": "zoom", "region": [10, 20, 300, 200], "scale": 0.8 }
{ "action": "left_click_drag", "start_coordinate": [10, 10], "coordinate": [100, 100] }
```

Actions: `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click`, `type`, `screenshot`, `wait`, `scroll`, `key`, `left_click_drag`, `zoom`, `scroll_to`, `hover`.

- Click actions accept `ref` or `coordinate`, not both.
- `modifiers` supports `ctrl`, `shift`, `alt`, `cmd/meta`, `win`.
- `key` accepts space-separated keys: `Backspace Backspace Delete`, `ArrowDown ArrowDown`, `ctrl+a`.
- Coordinates are in the most recent screenshot image frame. Myna maps them back to CSS pixels automatically.
- Drag requires trusted browser control.
- Screenshots are normalized to the configured max width; the result tells the model the image size.

## `file_upload`

```json
{ "ref": "ref_7" }
```

Attaches files the user picked with the **Files** button in the Myna composer to an `<input type="file">`. Uses a synthetic `DataTransfer`; some sites require a real picker, so verify the page shows the files. Up to 4 files, 5 MB each. The file bytes stay in the current run and are not saved to chat history.

## `web_fetch`

```json
{ "url": "https://example.com/docs", "max_chars": 50000 }
```

Fetches an `http(s)` URL directly from the service worker with `credentials: 'omit'`, strips scripts/styles, and returns readable text. It does not execute page JavaScript, carry cookies, or bypass authentication.

## `web_search`

```json
{ "query": "openai api docs", "limit": 8 }
```

Fetches Bing's RSS endpoint and returns title, URL, and snippet rows. It is a lightweight scrape, not a licensed search API; Bing can rate-limit or change its RSS output. Use `web_fetch` to read a result.

## `gif_creator`

```json
{ "action": "start_recording" }
{ "action": "stop_recording" }
{ "action": "export", "download": true, "filename": "demo.gif" }
{ "action": "clear" }
```

Records up to 40 frames at 640 px wide after browser actions, then encodes a GIF in the page context. Frames live in service-worker memory and are lost if the worker is terminated. Export returns the GIF in the tool card and can download it with `download: true`.

## `navigate`

```json
{ "url": "https://example.com" }
{ "url": "back" }
{ "url": "forward" }
```

Only `http(s)` URLs. Browser-internal pages are blocked.

## `tabs_context`

```json
{ "all_windows": false }
```

Lists tab IDs, titles, URLs, active state, and group IDs. The current tab is called out.

## `tabs_create`

```json
{ "url": "https://example.com", "active": true }
```

Creates a tab, joins the Myna group when grouping is enabled, returns the new tab ID.

## `tabs_close`

```json
{ "tabId": 123 }
```

Refuses to close the last tab.

## `read_console_messages`

```json
{ "pattern": "error", "limit": 100, "clear": false }
```

Requires the optional debugger permission. Matches a case-insensitive substring or `/regex/`. The buffer starts when Myna attaches.

## `read_network_requests`

```json
{ "pattern": "/api\\//", "limit": 100, "clear": false }
```

Requires the optional debugger permission. Returns method, URL, status, type, MIME type, size, duration, cache flag, and failure text. Does not return headers or bodies.

## `resize_window`

```json
{ "width": 1280, "height": 900 }
```

Resizes the window containing the tab.

## `browser_batch`

```json
{
  "actions": [
    { "name": "navigate", "input": { "url": "https://example.com" } },
    { "name": "find", "input": { "query": "search box" } },
    { "name": "computer", "input": { "action": "left_click", "ref": "ref_3" } },
    { "name": "computer", "input": { "action": "screenshot" } }
  ]
}
```

Executes up to 12 actions sequentially. Stops on the first error. Each sub-action runs its own permission check. `browser_batch` cannot be nested.

## `update_plan`

```json
{
  "domains": ["example.com", "docs.example.com"],
  "approach": ["Open the pricing page", "Compare the middle plans", "Summarize the tradeoffs"]
}
```

In plan mode, the side panel shows a plan card with **Approve & run** and **Cancel**. Approval adds the domains to the conversation's approved set. In other modes the plan is informational.

## `javascript_tool`

```json
{ "action": "javascript_exec", "text": "document.title" }
```

Off by default. Runs in the page's main world through CDP with REPL semantics (top-level `await`, last expression returned). Output is sanitized: JWTs, cookie/query strings, base64 blobs, long hex strings, and object keys matching password/token/secret are redacted.

## Remote MCP tools

Configure a Streamable HTTP MCP server in Settings → MCP. Myna calls `initialize`, `notifications/initialized`, and `tools/list`, then exposes each tool as:

```
mcp__<serverId>__<toolName>
```

Input schemas come from the server. In Ask and Plan modes the permission card appears before every MCP call; Auto-run allows them. Text, images, and resource text are converted into tool results. Stdio MCP and legacy HTTP+SSE transport are not supported.

## Permission kinds

| Tool | Kind |
| --- | --- |
| `read_page`, `get_page_text`, `find`, `tabs_context` | read |
| `read_console_messages`, `read_network_requests` | read |
| `computer` screenshot/wait/scroll/scroll_to/hover/zoom | read |
| `computer` click/type/key/drag | act |
| `form_input`, `file_upload`, `navigate`, `tabs_create`, `tabs_close`, `resize_window` | act |
| `gif_creator` | act |
| `web_fetch`, `web_search` | read |
| `browser_batch` | meta; each sub-action checks |
| `update_plan` | meta |
| `javascript_tool` | act |
