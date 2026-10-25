# Contributing

Thanks for helping. Myna is intentionally small and dependency-free. Keep changes easy to audit.

## Ground rules

- No bundler, no minified code, no remote scripts.
- No new dependencies unless there is a strong reason and the licence is compatible.
- Keep the provider adapters independent. A new provider should be a small adapter, not a fork of the agent.
- Do not add telemetry, remote config, or a Myna backend.
- Preserve the permission model: read and act are separate, sensitive hosts prompt, and password/card fields stay blocked.
- Treat page content as untrusted. Do not add code paths that follow instructions from a page.

## Development

```bash
npm test
npm run check
```

Load the folder unpacked in `chrome://extensions`, open a normal web page, and use the side panel.

## Adding a provider

1. Add a preset in `src/lib/constants.js`.
2. If the provider speaks Anthropic Messages or OpenAI Chat Completions, no adapter code is needed.
3. If it needs a different wire format, add `src/lib/providers/<name>.js` with a `streamX` function and route to it in `src/lib/providers/index.js`.
4. Add unit tests for message conversion and streaming events.
5. Document it in `README.md` and `docs/providers.md`.

## Adding a tool

1. Add the schema and kind in `src/lib/tools-schema.js`.
2. Implement execution in `src/background/tool-executor.js` with a permission check.
3. Add a UI summary and icon in `src/sidepanel/components.js`.
4. Add a test for permission behavior and argument validation.
5. Document it in `docs/tools.md`.

## Pull requests

- Keep commits focused.
- Include a short “what changed / why” in the PR.
- Run `npm test` and `npm run check` before opening.
- Include screenshots for UI changes.
- Do not commit API keys, browser profiles, or test artifacts.
- CI runs the unit tests and static checks on Node 20 and 22.

## Releases

1. Update `CHANGELOG.md`, `package.json`, and `manifest.json`.
2. Add release notes under `docs/releases/`.
3. Commit, tag with `vX.Y.Z`, and push the tag.
4. The release workflow builds `myna-browser-agent-X.Y.Z.zip` and publishes it on GitHub.

## Licence

Contributions are accepted under the MIT licence.
