# Codex Python SDK Adapter

OpenPointer can connect to Codex through a small local HTTP/SSE adapter backed by the official `openai-codex` Python SDK.

## Install

```powershell
python -m pip install --upgrade openai-codex
```

The package requires Python 3.10 or later. Current beta builds include a compatible Codex CLI runtime dependency and reuse existing Codex authentication when available.

## Start The Adapter

```powershell
npm run codex:adapter
```

OpenPointer starts this adapter automatically when the Codex connection is set to the default Python SDK adapter URL. You can still run it manually for debugging. The adapter listens on `http://127.0.0.1:5050/v1` by default and exposes:

- `GET /healthz`
- `POST /v1/runs`
- `GET /v1/runs/{run_id}/events`

## Configure OpenPointer

Use these settings in `.env` or the in-app settings panel:

```env
OP_AGENT_BACKEND=codex
OP_CODEX_APP_SERVER_TRANSPORT=http-adapter
OP_CODEX_APP_SERVER_URL=http://127.0.0.1:5050/v1
OP_CODEX_API_KEY=
OP_CODEX_MODEL=gpt-5.4
OP_CODEX_EFFORT=low
OP_CODEX_SANDBOX=workspace-write
OP_CODEX_WORKSPACE=D:\OpenMagicPointer
```

`OP_CODEX_API_KEY` is optional when the local Codex login is already available. If present, OpenPointer sends it as a bearer token and the adapter calls `Codex.login_api_key(...)`.

## Official References

- OpenAI Codex Python SDK package: https://pypi.org/project/openai-codex/
- Codex Python SDK docs: https://github.com/openai/codex/tree/main/sdk/python
- Codex app-server protocol: https://github.com/openai/codex/tree/main/codex-rs/app-server
