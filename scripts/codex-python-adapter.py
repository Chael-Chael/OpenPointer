#!/usr/bin/env python3
"""HTTP/SSE adapter from OpenPointer's AgentBridge protocol to openai-codex."""

from __future__ import annotations

import argparse
import json
import os
import queue
import threading
import time
import uuid
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

try:
    from openai_codex import Codex, LocalImageInput, Sandbox, TextInput
except ModuleNotFoundError:  # pragma: no cover - exercised only without the SDK installed.
    Codex = None
    LocalImageInput = None
    Sandbox = None
    TextInput = None


TERMINAL_EVENTS = {"run.completed", "run.failed"}


@dataclass
class RunRecord:
    run_id: str
    session_key: str
    body: dict[str, Any]
    api_key: str
    events: "queue.Queue[dict[str, Any]]" = field(default_factory=queue.Queue)
    created_at: float = field(default_factory=time.time)


@dataclass
class AdapterState:
    runs: dict[str, RunRecord] = field(default_factory=dict)
    sessions: dict[str, str] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)


STATE = AdapterState()


def main() -> None:
    parser = argparse.ArgumentParser(description="OpenPointer Codex Python SDK adapter")
    parser.add_argument("--host", default=os.environ.get("OP_CODEX_ADAPTER_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("OP_CODEX_ADAPTER_PORT", "5050")))
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), CodexAdapterHandler)
    print(f"Codex Python SDK adapter listening on http://{args.host}:{args.port}/v1", flush=True)
    server.serve_forever()


class CodexAdapterHandler(BaseHTTPRequestHandler):
    server_version = "OpenPointerCodexPythonAdapter/0.1"

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in {"/healthz", "/readyz", "/v1/healthz", "/v1/readyz"}:
            self._json({"ok": Codex is not None, "sdk": "openai-codex"}, HTTPStatus.OK if Codex is not None else HTTPStatus.SERVICE_UNAVAILABLE)
            return

        run_id = _run_id_from_events_path(path)
        if run_id:
            self._stream_events(run_id)
            return

        self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/")
        if path not in {"/runs", "/v1/runs"}:
            self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)
            return
        if Codex is None:
            self._json({"error": "Missing dependency: pip install openai-codex"}, HTTPStatus.SERVICE_UNAVAILABLE)
            return

        try:
            body = self._read_json_body()
        except ValueError as error:
            self._json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return

        run_id = f"codex-{uuid.uuid4().hex}"
        session_key = str(body.get("thread") or body.get("session_id") or body.get("sessionKey") or run_id)
        record = RunRecord(run_id=run_id, session_key=session_key, body=body, api_key=_bearer_token(self.headers.get("Authorization", "")))
        with STATE.lock:
            STATE.runs[run_id] = record

        worker = threading.Thread(target=_run_codex, args=(record,), daemon=True)
        worker.start()

        self._json({"id": run_id, "run_id": run_id, "events_url": f"/v1/runs/{run_id}/events"})

    def log_message(self, fmt: str, *args: Any) -> None:
        if os.environ.get("OP_CODEX_ADAPTER_LOG_REQUESTS"):
            super().log_message(fmt, *args)

    def _read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        if length > 20 * 1024 * 1024:
            raise ValueError("request body too large")
        raw = self.rfile.read(length)
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("request body must be a JSON object")
        return data

    def _stream_events(self, run_id: str) -> None:
        with STATE.lock:
            record = STATE.runs.get(run_id)
        if not record:
            self._json({"error": "run not found"}, HTTPStatus.NOT_FOUND)
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        while True:
            event = record.events.get()
            payload = json.dumps(event, ensure_ascii=False)
            self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
            self.wfile.flush()
            if event.get("type") in TERMINAL_EVENTS:
                self.close_connection = True
                break

    def _json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def _run_codex(record: RunRecord) -> None:
    _emit(record, {"type": "run.started", "runId": record.run_id, "backend": "codex"})
    try:
        assert Codex is not None
        api_key = record.api_key or os.environ.get("OP_CODEX_API_KEY", "").strip()
        cwd = str(record.body.get("cwd") or os.environ.get("OP_CODEX_WORKSPACE") or os.getcwd())
        model = _optional_str(record.body.get("model") or os.environ.get("OP_CODEX_MODEL"))
        effort = _optional_str(record.body.get("effort") or os.environ.get("OP_CODEX_EFFORT"))
        sandbox = _sandbox(record.body.get("sandbox") or os.environ.get("OP_CODEX_SANDBOX", "workspace-write"))
        run_input = _build_run_input(record.body)

        with Codex() as codex:
            if api_key:
                codex.login_api_key(api_key)

            thread = _thread_for_record(codex, record, cwd=cwd, model=model, sandbox=sandbox)
            _emit(record, {"type": "backend.session", "backend": "codex", "sessionId": thread.id})

            result = thread.run(run_input, cwd=cwd, effort=effort, model=model, sandbox=sandbox)
            final_response = getattr(result, "final_response", None) or ""
            if final_response:
                _emit(record, {"type": "assistant.delta", "text": final_response})
            _emit(record, {"type": "run.completed", "text": final_response or None})
    except Exception as error:  # noqa: BLE001 - adapter must report SDK/runtime failures to the app.
        _emit(record, {"type": "run.failed", "error": str(error), "recoverable": True})


def _thread_for_record(codex: Any, record: RunRecord, *, cwd: str, model: str | None, sandbox: Any) -> Any:
    with STATE.lock:
        thread_id = STATE.sessions.get(record.session_key)

    if thread_id:
        try:
            return codex.thread_resume(thread_id, cwd=cwd, model=model, sandbox=sandbox)
        except Exception:
            pass

    try:
        thread = codex.thread_resume(record.session_key, cwd=cwd, model=model, sandbox=sandbox)
        with STATE.lock:
            STATE.sessions[record.session_key] = thread.id
        return thread
    except Exception:
        pass

    thread = codex.thread_start(cwd=cwd, model=model, sandbox=sandbox)
    with STATE.lock:
        STATE.sessions[record.session_key] = thread.id
    return thread


def _build_run_input(body: dict[str, Any]) -> Any:
    prompt = _build_prompt(body)
    attachments = body.get("attachments") if isinstance(body.get("attachments"), list) else []
    local_paths = [
        str(item.get("temp_path"))
        for item in attachments
        if isinstance(item, dict) and item.get("temp_path") and os.path.exists(str(item.get("temp_path")))
    ]

    if not local_paths or TextInput is None or LocalImageInput is None:
        return prompt

    return [TextInput(text=prompt), *[LocalImageInput(path=path) for path in local_paths]]


def _build_prompt(body: dict[str, Any]) -> str:
    instructions = _optional_str(body.get("instructions"))
    user_input = _optional_str(body.get("input") or body.get("prompt")) or ""
    metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    attachments = body.get("attachments") if isinstance(body.get("attachments"), list) else []

    parts: list[str] = []
    if instructions:
        parts.append(f"Instructions:\n{instructions}")
    if metadata:
        parts.append(f"OpenPointer metadata:\n{json.dumps(metadata, ensure_ascii=False, indent=2)}")
    if attachments:
        summaries = []
        for item in attachments:
            if not isinstance(item, dict):
                continue
            summaries.append(
                {
                    "label": item.get("label"),
                    "type": item.get("type"),
                    "mime_type": item.get("mime_type"),
                    "temp_path": item.get("temp_path"),
                    "crop": item.get("crop"),
                }
            )
        if summaries:
            parts.append(f"Attachments:\n{json.dumps(summaries, ensure_ascii=False, indent=2)}")
    parts.append(f"User request:\n{user_input}")
    return "\n\n".join(parts)


def _sandbox(value: Any) -> Any:
    if Sandbox is None:
        return None
    normalized = str(value or "").strip().lower().replace("_", "-")
    mapping = {
        "read-only": "read_only",
        "readonly": "read_only",
        "workspace-write": "workspace_write",
        "workspace": "workspace_write",
        "full-access": "full_access",
        "danger-full-access": "full_access",
    }
    attr = mapping.get(normalized)
    return getattr(Sandbox, attr) if attr else None


def _emit(record: RunRecord, event: dict[str, Any]) -> None:
    record.events.put(event)


def _run_id_from_events_path(path: str) -> str | None:
    parts = [part for part in path.split("/") if part]
    if len(parts) == 3 and parts[0] == "runs" and parts[2] == "events":
        return parts[1]
    if len(parts) == 4 and parts[0] == "v1" and parts[1] == "runs" and parts[3] == "events":
        return parts[2]
    return None


def _bearer_token(value: str) -> str:
    prefix = "Bearer "
    return value[len(prefix) :].strip() if value.startswith(prefix) else ""


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


if __name__ == "__main__":
    main()
