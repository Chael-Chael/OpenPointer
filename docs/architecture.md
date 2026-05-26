# OpenMagicPointer Architecture

OpenMagicPointer is a desktop-first AI pointer assistant. The application owns user intent, pointer context, memory, action preview, and safety policy. Cua is treated as an external execution layer for confirmed computer-use actions.

The first implementation is an Electron app with typed internal packages:

- `core`: canonical data types, action plans, risk policy, and session memory.
- `gestures`: mouse wiggle activation, trail state, hover/sweep/lasso/rectangle gesture primitives.
- `grounding`: turns cursor, window, visual, and gesture information into `PointerContext`.
- `intent`: local first intent recommendation.
- `voice`: voice command parsing and a small voice state machine.
- `backends`: OpenAI-compatible LLM adapter.
- `executors`: Cua and mock executors behind a common adapter.
- `storage`: local settings, history, and audit abstractions.

The model is never allowed to directly operate the computer. Model output is converted into a `PointerActionPlan`, validated locally, previewed to the user, and only then executed.
