/**
 * Shared constants for Myna.
 *
 * Everything here is dependency-free so it can be imported by the service
 * worker, the side panel, the options page, and Node-based tests.
 */

export const APP_NAME = 'Myna';
export const APP_TAGLINE = 'Your open browser agent';
export const APP_VERSION = '0.2.0';

export const STORAGE_KEYS = Object.freeze({
  SETTINGS: 'myna.settings.v1',
  SESSIONS: 'myna.sessions.v1',
  ACTIVE_SESSION: 'myna.activeSession.v1',
  SESSION_SECRETS: 'myna.sessionSecrets.v1',
  PENDING_PROMPT: 'myna.pendingPrompt.v1',
  ONBOARDING: 'myna.onboarding.v1'
});

export const PERMISSION_MODES = Object.freeze({
  ASK: 'ask',
  AUTO: 'auto',
  READONLY: 'readonly',
  PLAN: 'plan'
});

export const PERMISSION_MODE_LABELS = Object.freeze({
  ask: 'Ask first',
  auto: 'Auto-run',
  readonly: 'Read only',
  plan: 'Plan first'
});

export const PERMISSION_MODE_DESCRIPTIONS = Object.freeze({
  ask: 'Myna asks before reading a new site or taking an action.',
  auto: 'Myna can read and act on pages without prompting. Domain changes still require approval.',
  readonly: 'Myna can read pages but cannot click, type, navigate, or change anything.',
  plan: 'Myna proposes a plan and domains first. After you approve it, it works autonomously on those domains.'
});

export const TOOL_KIND = Object.freeze({
  READ: 'read',
  ACT: 'act',
  META: 'meta'
});

/**
 * Provider presets. These are starting points, not an exhaustive list.
 * Model IDs move fast; every preset is editable in Settings.
 */
export const PROVIDER_PRESETS = Object.freeze({
  anthropic: {
    label: 'Anthropic',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    authStyle: 'x-api-key',
    authLabel: 'x-api-key header',
    supportsImages: true,
    maxOutputTokens: 4096,
    contextWindow: 200000,
    includeCacheControl: true,
    hint: 'Paste a Claude API key from console.anthropic.com.'
  },
  openai: {
    label: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1',
    authStyle: 'bearer',
    authLabel: 'Bearer token',
    supportsImages: true,
    maxOutputTokens: 4096,
    contextWindow: 128000,
    hint: 'Any chat-completions-compatible model works.'
  },
  opencodeGo: {
    label: 'OpenCode Go',
    type: 'openai',
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    model: 'deepseek-v4.1-flash',
    authStyle: 'bearer',
    authLabel: 'Bearer token',
    supportsImages: true,
    maxOutputTokens: 8192,
    contextWindow: 256000,
    hint: 'OpenCode Go subscription key. OpenAI-compatible endpoint; a session header is added for routing and caching.'
  },
  opencodeGoAnthropic: {
    label: 'OpenCode Go (Anthropic)',
    type: 'anthropic',
    baseUrl: 'https://opencode.ai/inference/go/anthropic',
    model: 'qwen3.8-flash',
    authStyle: 'bearer',
    authLabel: 'Bearer token',
    supportsImages: true,
    maxOutputTokens: 8192,
    contextWindow: 256000,
    hint: 'For Go models on the Anthropic Messages API: Qwen, MiniMax M3, and Claude Haiku 5.5. Same key and session header.'
  },
  gemini: {
    label: 'Google Gemini',
    type: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-pro',
    authStyle: 'bearer',
    authLabel: 'Bearer token',
    supportsImages: true,
    maxOutputTokens: 4096,
    contextWindow: 1000000,
    hint: 'Uses Gemini\'s OpenAI-compatible endpoint. Get a key at aistudio.google.com.'
  },
  openrouter: {
    label: 'OpenRouter',
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4.5',
    authStyle: 'bearer',
    authLabel: 'Bearer token',
    supportsImages: true,
    maxOutputTokens: 4096,
    contextWindow: 200000,
    headers: {
      'HTTP-Referer': 'https://github.com/myna-browser/myna',
      'X-Title': 'Myna'
    },
    hint: 'One key, hundreds of models.'
  },
  groq: {
    label: 'Groq',
    type: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    authStyle: 'bearer',
    authLabel: 'Bearer token',
    supportsImages: false,
    maxOutputTokens: 4096,
    contextWindow: 128000,
    hint: 'Very fast open models.'
  },
  deepseek: {
    label: 'DeepSeek',
    type: 'openai',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    authStyle: 'bearer',
    authLabel: 'Bearer token',
    supportsImages: false,
    maxOutputTokens: 4096,
    contextWindow: 128000,
    hint: 'Set model to deepseek-reasoner for the reasoning model.'
  },
  mistral: {
    label: 'Mistral',
    type: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    authStyle: 'bearer',
    authLabel: 'Bearer token',
    supportsImages: true,
    maxOutputTokens: 4096,
    contextWindow: 128000
  },
  xai: {
    label: 'xAI',
    type: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4',
    authStyle: 'bearer',
    authLabel: 'Bearer token',
    supportsImages: true,
    maxOutputTokens: 4096,
    contextWindow: 256000
  },
  together: {
    label: 'Together AI',
    type: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    authStyle: 'bearer',
    authLabel: 'Bearer token',
    supportsImages: false,
    maxOutputTokens: 4096,
    contextWindow: 128000
  },
  fireworks: {
    label: 'Fireworks AI',
    type: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    model: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    authStyle: 'bearer',
    authLabel: 'Bearer token',
    supportsImages: false,
    maxOutputTokens: 4096,
    contextWindow: 128000
  },
  ollama: {
    label: 'Ollama (local)',
    type: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    authStyle: 'none',
    authLabel: 'No key',
    supportsImages: false,
    maxOutputTokens: 4096,
    contextWindow: 128000,
    hint: 'Start Ollama, then pull a tool-capable model such as llama3.1 or qwen2.5.'
  },
  lmstudio: {
    label: 'LM Studio (local)',
    type: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    authStyle: 'none',
    authLabel: 'No key',
    supportsImages: false,
    maxOutputTokens: 4096,
    contextWindow: 128000,
    hint: 'Enable the local server in LM Studio and load a tool-capable model.'
  },
  azure: {
    label: 'Azure OpenAI',
    type: 'openai',
    baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT',
    model: 'gpt-4.1',
    authStyle: 'api-key',
    authLabel: 'api-key header',
    supportsImages: true,
    maxOutputTokens: 4096,
    contextWindow: 128000,
    query: 'api-version=2024-10-21',
    hint: 'Put the deployment path in the base URL. The api-version query is appended automatically.'
  },
  custom: {
    label: 'Custom OpenAI-compatible',
    type: 'openai',
    baseUrl: '',
    model: '',
    authStyle: 'bearer',
    authLabel: 'Bearer token',
    supportsImages: true,
    maxOutputTokens: 4096,
    contextWindow: 128000,
    hint: 'Point this at any /chat/completions endpoint, gateway, or proxy.'
  }
});

export const PROVIDER_ORDER = [
  'anthropic',
  'openai',
  'opencodeGo',
  'opencodeGoAnthropic',
  'gemini',
  'openrouter',
  'groq',
  'deepseek',
  'mistral',
  'xai',
  'together',
  'fireworks',
  'ollama',
  'lmstudio',
  'azure',
  'custom'
];

/**
 * Common model IDs per preset. These are suggestions, not a whitelist.
 * Providers rename and retire models constantly; the field is free text.
 */
export const MODEL_PRESETS = Object.freeze({
  anthropic: [
    'claude-sonnet-4-5',
    'claude-opus-4-5',
    'claude-haiku-4-5'
  ],
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'o4-mini'],
  opencodeGo: [
    'deepseek-v4.1-flash',
    'deepseek-v4-pro',
    'kimi-k3',
    'kimi-k3.1-pro',
    'kimi-k2.7-code',
    'glm-5.3',
    'glm-5.3-flash',
    'glm-5.2',
    'minimax-m3.1-flash',
    'mimo-v2.6-flash',
    'mimo-v2.6-pro',
    'mimo-v2.5',
    'mimo-v2.5-pro',
    'hy4-preview',
    'hy3',
    'longcat-2.0',
    'longcat-2.5-preview-free',
    'step-5-preview',
    'beam-free'
  ],
  opencodeGoAnthropic: [
    'qwen3.8-max',
    'qwen3.8-flash',
    'qwen3.7-plus',
    'minimax-m3',
    'claude-haiku-5-5'
  ],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  openrouter: [
    'anthropic/claude-sonnet-4.5',
    'openai/gpt-4.1',
    'google/gemini-2.5-pro',
    'meta-llama/llama-3.3-70b-instruct'
  ],
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'qwen/qwen3-32b'
  ],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  mistral: ['mistral-large-latest', 'mistral-medium-latest', 'codestral-latest'],
  xai: ['grok-4', 'grok-3', 'grok-3-mini'],
  together: [
    'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    'Qwen/Qwen2.5-72B-Instruct-Turbo'
  ],
  fireworks: [
    'accounts/fireworks/models/llama-v3p3-70b-instruct',
    'accounts/fireworks/models/qwen3-235b-a22b'
  ],
  ollama: ['llama3.1', 'qwen2.5', 'qwen2.5-coder', 'mistral'],
  lmstudio: ['local-model'],
  azure: ['gpt-4.1', 'gpt-4o', 'o4-mini'],
  custom: []
});

/**
 * Agent behaviour presets. Applied in Settings → Agent.
 */
export const AGENT_PRESETS = Object.freeze({
  cautious: {
    label: 'Cautious',
    description: 'Ask before everything. No debugger, no auto-run.',
    values: {
      maxSteps: 12,
      trustedInput: false,
      groupTabs: true,
      confirmDomainChanges: true,
      animations: true,
      javascriptTool: false,
      includePageContext: true,
      includeSelectedText: true,
      maxHistoryMessages: 40,
      maxContextChars: 80000,
      keepScreenshots: 1,
      streamResponses: true
    },
    mode: 'ask'
  },
  balanced: {
    label: 'Balanced',
    description: 'Ask first, but use trusted input and keep tabs grouped.',
    values: {
      maxSteps: 20,
      trustedInput: true,
      groupTabs: true,
      confirmDomainChanges: true,
      animations: true,
      javascriptTool: false,
      includePageContext: true,
      includeSelectedText: true,
      maxHistoryMessages: 80,
      maxContextChars: 120000,
      keepScreenshots: 2,
      streamResponses: true
    },
    mode: 'ask'
  },
  agent: {
    label: 'Agent',
    description: 'Claude-Code-ish: auto-run, longer tasks, grouped tabs, visible cursor.',
    values: {
      maxSteps: 30,
      trustedInput: true,
      groupTabs: true,
      confirmDomainChanges: true,
      animations: true,
      javascriptTool: false,
      includePageContext: true,
      includeSelectedText: true,
      maxHistoryMessages: 120,
      maxContextChars: 160000,
      keepScreenshots: 3,
      streamResponses: true
    },
    mode: 'auto'
  },
  planner: {
    label: 'Planner',
    description: 'Plan and domains first, then act autonomously.',
    values: {
      maxSteps: 30,
      trustedInput: true,
      groupTabs: true,
      confirmDomainChanges: true,
      animations: true,
      javascriptTool: false,
      includePageContext: true,
      includeSelectedText: true,
      maxHistoryMessages: 120,
      maxContextChars: 160000,
      keepScreenshots: 2,
      streamResponses: true
    },
    mode: 'plan'
  }
});

/**
 * Permission presets. Applied in Settings → Permissions.
 *
 * Only the default mode changes. Existing per-site rules are kept, so a
 * preset never silently widens or narrows access you configured by hand.
 */
export const PERMISSION_PRESETS = Object.freeze({
  lockedDown: {
    label: 'Locked down',
    description: 'Read pages only. Every action is denied, including navigation.',
    mode: 'readonly'
  },
  askFirst: {
    label: 'Ask first',
    description: 'Approve reads and actions site by site. The safest default.',
    mode: 'ask'
  },
  planFirst: {
    label: 'Plan first',
    description: 'Review a plan and its domains, then let Myna work autonomously.',
    mode: 'plan'
  },
  autopilot: {
    label: 'Autopilot',
    description: 'Act without prompts. Sensitive sites and new domains still ask.',
    mode: 'auto'
  }
});

/**
 * Appearance presets. Applied in Settings → Appearance.
 */
export const APPEARANCE_PRESETS = Object.freeze({
  system: {
    label: 'Follow system',
    description: 'Match Chrome, with comfortable spacing.',
    values: { theme: 'system', density: 'comfortable' }
  },
  paper: {
    label: 'Paper',
    description: 'Warm light theme with comfortable spacing.',
    values: { theme: 'light', density: 'comfortable' }
  },
  midnight: {
    label: 'Midnight',
    description: 'Dark theme for low light.',
    values: { theme: 'dark', density: 'comfortable' }
  },
  compact: {
    label: 'Compact',
    description: 'Follow system, with tighter spacing for more messages.',
    values: { theme: 'system', density: 'compact' }
  }
});

export const AUTH_STYLES = Object.freeze({
  bearer: 'Authorization: Bearer <key>',
  'x-api-key': 'x-api-key: <key>',
  'api-key': 'api-key: <key>',
  none: 'No authentication header'
});

export const QUICK_PROMPTS = Object.freeze([
  {
    title: 'Summarize this page',
    prompt: 'Give me a concise summary of this page, with the key facts and any decisions I need to make.',
    icon: 'sparkles'
  },
  {
    title: 'Find something',
    prompt: 'Find the most relevant information on this page for: ',
    icon: 'search'
  },
  {
    title: 'Fill this form',
    prompt: 'Look at the form on this page, tell me what it needs, and help me fill it in. Ask before submitting anything.',
    icon: 'form'
  },
  {
    title: 'Explain this error',
    prompt: 'Explain what this error means and how to fix it. Use the console if there is one.',
    icon: 'terminal'
  }
]);

export const SENSITIVE_INPUT_TYPES = Object.freeze([
  'password',
  'hidden'
]);

export const SENSITIVE_AUTOCOMPLETE = Object.freeze([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year'
]);

export const MAX_TOOL_OUTPUT_CHARS = 50000;
export const MAX_PAGE_ELEMENTS = 10000;
export const MAX_BATCH_ACTIONS = 12;
export const MAX_SESSIONS = 100;
export const DEFAULT_SCREENSHOT_MAX_WIDTH = 1280;
