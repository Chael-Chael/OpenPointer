# OpenPointer Architecture

OpenPointer is a desktop pointer context bridge. It captures what the user points at, collects screenshot/window/cursor context, accepts text or voice instructions, and streams results from a local VLM or an external agent backend.

The app no longer owns local computer-use execution. CUA, MCP tools, and skills are selected and invoked by the configured agent runtime.

Packages:

- `core`: pointer context, agent envelope, CUA directive, and agent event contracts.
- `gestures`: cursor trail and region geometry utilities.
- `grounding`: converts cursor, screenshot crop, and window metadata into `PointerContext`.
- `agent-bridge`: Local VLM, Hermes, OpenCode, Claude Code, Codex, and mock bridge adapters.
- `backends`: OpenAI-compatible model transport used by Local VLM fallback.
- `voice`: speech text normalization into user instructions.
- `storage`: local app settings and future history/audit shapes.
- `apps/desktop`: Electron overlay, global long press, command bubble UI, and IPC streaming.

Runtime flow:

```text
long press
-> command bubble
-> AgentContextEnvelope
-> AgentBridge.run()
-> AgentEvent stream
-> bubble progress/result/approval UI
```

OpenPointer passes generic tool hints such as app-specific MCP, document skill, screen skill, and CUA. It does not hardcode app-specific paths.
