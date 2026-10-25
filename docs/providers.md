# Providers

Myna supports two wire formats. Most providers fit one of them.

## Anthropic Messages

Used when `profile.type === 'anthropic'`.

- Endpoint: `{baseUrl}/v1/messages` (or `{baseUrl}/messages` if the base already ends in `/v1`)
- Auth: `x-api-key` by default; `Authorization: Bearer` also supported for gateways
- Headers: `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`
- Tools: `{ name, description, input_schema }`
- Tool calls: `tool_use` blocks
- Tool results: `tool_result` blocks inside a user message
- Prompt caching: optional `cache_control: { type: 'ephemeral' }` on system and the last tool

The adapter groups consecutive tool results into one user message, which the API requires.

### Anthropic-compatible gateways

Set the type to **Anthropic Messages**, point the base URL at the gateway, and choose the auth style it expects. Turn off **Use Anthropic prompt caching headers** if the gateway rejects `cache_control`.

## OpenAI Chat Completions

Used when `profile.type === 'openai'`.

- Endpoint: `{baseUrl}/chat/completions`, unless the base already ends with `/chat/completions`
- Auth: Bearer, `x-api-key`, `api-key`, or none
- Extra query string: appended (useful for Azure `api-version`)
- Extra headers: JSON object per profile
- Tools: function tools
- Tool calls: `tool_calls` on assistant messages
- Tool results: `role: 'tool'` messages

Streaming tool-call arguments are accumulated per index. Both `tool_calls` and the older `function_call` shape are accepted.

### Azure OpenAI

- API shape: OpenAI Chat Completions
- Base URL: `https://RESOURCE.openai.azure.com/openai/deployments/DEPLOYMENT`
- Auth: `api-key`
- Extra query: `api-version=2024-10-21`
- Model: any value; Azure routes by deployment

### Ollama

```bash
ollama pull llama3.1
ollama serve
```

- Base URL: `http://localhost:11434/v1`
- Auth: none
- Model: `llama3.1`, `qwen2.5`, or another tool-capable model

### LM Studio

Enable the local server in LM Studio, load a tool-capable model, then use:

- Base URL: `http://localhost:1234/v1`
- Auth: none
- Model: the model identifier shown in LM Studio

### Gemini via OpenAI compatibility

- Base URL: `https://generativelanguage.googleapis.com/v1beta/openai`
- Auth: Bearer
- Model: `gemini-2.5-pro`, `gemini-2.5-flash`, etc.

Gemini's OpenAI compatibility layer supports function calling and images, though feature parity can lag the native API.

### OpenCode Go

Two presets cover the two Go wire formats. Both use a Bearer key and a generated `x-opencode-session` header; chats replace it with the conversation ID so Go can route and cache efficiently, while connection tests use the profile value.

- **OpenAI-compatible:** base `https://opencode.ai/inference/go/openai/v1`, endpoint `/chat/completions`. DeepSeek V4, Kimi, GLM, MiMo, MiniMax M3.1 Flash, Hy, LongCat, Step, and Beam models.
- **Anthropic Messages:** base `https://opencode.ai/inference/go/anthropic`, endpoint `/v1/messages`. Qwen 3.8/3.7, MiniMax M3, and Claude Haiku 5.5.

Model IDs, quotas, and available models come from `GET https://opencode.ai/inference/go/v1/models`. Grok 4.7, GPT Luna, and Muse Spark use the Responses API; Gemini 4 Argon uses Google's native API. Neither preset covers those formats.

## Adding a new adapter

If a provider does not speak either format:

1. Create `src/lib/providers/yourprovider.js`.
2. Export `streamYourProvider({ profile, system, messages, tools, settings, signal, onText, onReasoning, onUsage })`.
3. Convert the provider-neutral messages (see `docs/architecture.md`) to its wire format.
4. Parse streaming events and return `{ text, reasoning, toolCalls, stopReason, usage }`.
5. Route to it from `src/lib/providers/index.js`.
6. Add a preset in `src/lib/constants.js`.
7. Add unit tests for conversion and streaming.

Keep secrets out of logs and never send the key anywhere except the configured endpoint.

## Model requirements

- **Tool calling is required** for browser actions.
- **Image input** is required for screenshots to be useful. If a model is text-only, set `supportsImages: false`; Myna will tell the model that images are omitted.
- **Streaming** can be disabled in Settings → Agent for gateways that dislike SSE.
- **Context window** is used only for the UI estimate. Myna trims history by characters and message units before sending.

## Testing a profile

Settings → Providers → **Test connection** sends a tiny non-streaming request. **Fetch models** calls `GET /models` for OpenAI-compatible endpoints. Anthropic does not expose a public browser model list, so type the ID manually.
