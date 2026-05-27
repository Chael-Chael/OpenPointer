# OpenMagicPointer

OpenMagicPointer is a desktop-first AI pointer assistant. It lets a user point, hover, sweep, lasso, speak, or type over screen content, then turns that context into safe AI actions with previews and explicit confirmation.

## Development

```powershell
npm install
npm run dev
```

Copy `.env.example` to `.env` for local provider configuration. Do not commit real API keys.

## Project docs

- Product notes: [`docs/product/OpenMagicPointer.md`](docs/product/OpenMagicPointer.md)
- Roadmap: [`docs/product/roadmap.md`](docs/product/roadmap.md)
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Safety policy: [`docs/safety.md`](docs/safety.md)
- Reference policy: [`docs/reference-policy.md`](docs/reference-policy.md)

## Current MVP

- Electron + React desktop overlay.
- Typed core data model.
- Mouse wiggle activation and shortcut activation.
- Cursor trail and pointer context chips.
- Hover, sweep, lasso, and rectangle context primitives.
- Local intent recommendations.
- Voice command parsing.
- OpenAI-compatible backend adapter.
- Cua HTTP executor adapter with preview/audit flow.
