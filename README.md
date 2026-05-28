# OpenMagicPointer

OpenMagicPointer is a desktop pointer context bridge. Long-press any screen object, enter a text or voice instruction, and the app sends screenshot, window, cursor, and target context to a local VLM or an agent backend.

OpenMagicPointer does not execute CUA locally. MCP, skills, CUA, and coding tools are selected and invoked by the configured agent runtime.

## Development

```powershell
npm install --cache .\.npm-cache
npm run dev
```

Copy `.env.example` to `.env` for local provider configuration. Do not commit real API keys.

## Current MVP

- Electron + React transparent desktop overlay.
- Global long-press activation with pointer loading ring.
- Compact command bubble for text and voice input.
- Real screenshot crop and pointer/window context capture.
- Unified `AgentContextEnvelope` and streamed `AgentEvent` UI.
- Local OpenAI-compatible VLM fallback.
- Hermes, OpenCode, Claude Agent, Codex, and mock bridge adapters with testable unavailable/error paths.
