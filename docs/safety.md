# Safety Policy

OpenMagicPointer is a context and instruction layer. It does not click, type, open apps, run shell commands, or execute CUA locally.

Rules:

1. Desktop-control requests are expressed as `CuaDirective` metadata for the agent backend.
2. State-changing backend requests must surface as `approval.requested` events before the UI allows approval.
3. Local VLM fallback is answer-only and must not claim to use tools or perform actions.
4. Tool output is treated as untrusted data.
5. API keys stay in environment variables or OS secure storage and must not be committed.
