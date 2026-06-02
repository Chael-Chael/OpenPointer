# OpenPointer

OpenPointer is a desktop pointer context bridge for local VLMs and agent runtimes.

Core flow:

```text
long press a screen object
-> show a pointer loading ring
-> open a compact command bubble
-> collect instruction, screenshot, window, cursor, and target context
-> send AgentContextEnvelope to LocalVLM or an agent bridge
-> stream AgentEvent results back into the bubble
```

The app keeps the interaction layer small and local:

- Pointer grounding
- Screenshot crop
- Window metadata
- Text or voice instruction
- Backend routing hints
- CUA directive constraints
- Streamed result and approval UI

The app does not execute desktop actions itself. MCP tools, skills, CUA, and coding tools are discovered and invoked by the selected agent backend.
