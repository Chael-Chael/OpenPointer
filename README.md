# 🪄 OpenPointer (OP)

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)](#)
[![Tech Stack](https://img.shields.io/badge/Stack-Electron%20%7C%20React%20%7C%20TypeScript-blue.svg)](#)

> **OpenPointer** is an elegant, high-performance desktop pointer context bridge. Long-press any screen object, input a text or voice command, and the application instantly captures visual, structural, and cursor context, sending it directly to a local VLM or custom agent backend.

---

## 👁️ Core Flow at a Glance

```text
[ Long Press Screen Object ]
      │
      ▼ (Displays Pointer Loading Ring)
[ Open Compact Command Bubble ]
      │
      ▼ (Captures Visual, Window, Cursor, & Grounded Element Context)
[ Bundle Context into Unified AgentContextEnvelope ]
      │
      ▼ (Send to Configured VLM / Agent Bridge)
[ Stream AgentEvent Results Back into Overlay Bubble ]
```

---

## ✨ Key Features

- 🖥️ **Sleek Transparent Overlay**: Powered by Electron & React, providing a zero-latency, beautiful, and click-through UI canvas that animates smoothly.
- 🎯 **Intelligent Pointer Grounding**: Wakes up via global long-press or hotkeys. Tracks complex gestures (hover, sweep, lasso, circle, wiggle) to target or isolate screen regions.
- 🧬 **Multi-Modal Context Capture**:
  - **Visual Context**: High-fidelity, localized screenshot crop around the cursor coordinates.
  - **Window Metadata**: Process name, PID, window title, and dimensions of the active window.
  - **Native UI Tree (CUA Integration)**: Extracts structured UI hierarchy lists, controls, bounding boxes, actions, and roles directly from the Windows Accessibility APIs (UIA/MSAA).
- 🎙️ **Rich Input & Voice bubble**: A beautifully compact command bubble supporting real-time text input and voice recordings/transcription.
- 🔌 **Unified Protocol & Streaming UI**:
  - Encapsulates all interactions into the type-safe `AgentContextEnvelope` spec.
  - Real-time event streaming (`AgentEvent`) displays agent thought processes, tool discovery, execution status, and markdown/math outputs in the bubble.
- 🛡️ **Human-in-the-Loop (HITL) Approvals**: Streams actions like `approval.requested` to let you inspect, approve, or deny sensitive desktop mouse/keyboard actions before they run.
- 🧠 **Context Compression**: Intelligently detects VLM context window limits (e.g., 32k tokens) and automatically compresses long conversations into concise dialogue summaries.

---

## 🧱 Monorepo Architecture

OpenPointer is structured as a clean TypeScript monorepo using npm workspaces:

```text
├── apps/
│   └── desktop/            # Electron + React transparent desktop overlay application
└── packages/
    ├── core/               # Shared type specifications (Contexts, Envelopes, Events)
    ├── gestures/           # Screen gesture tracking, sweeps, lassos, and wiggles
    ├── grounding/          # Coordinate matching, target pickers, and screen alignment
    ├── voice/              # Audio capture states and voice transcription inputs
    ├── storage/            # Persistent user config, custom profiles, and history
    ├── backends/           # OpenAI-compatible LLM/VLM backend clients
    └── agent-bridge/       # Unified routing integrations:
                            ├── Local VLM (Ollama, LM Studio, vLLM fallback)
                            ├── Claude Code (Anthropic Computer Use API)
                            ├── HTTP Bridges (Hermes, OpenCode, Codex stream adapters)
                            └── Mock Bridge (Robust offline validation and diagnostics)
```

---

## 🛠️ Installation & Setup

### Prerequisites

- **OS**: Windows (Native UI extraction and CUA engine depend on Windows accessibility APIs).
- **Runtime**: [Node.js](https://nodejs.org/) (v20+ recommended) and npm.
- **Git**: Required to pull repository submodules.

---

### Step-by-Step Guide

### 1. Clone Repository & Submodules
OpenPointer relies on standard submodules (e.g., `cua` for Computer Use Agent execution). Make sure to clone recursively:

```powershell
git clone --recursive https://github.com/Chael-Chael/OpenPointer.git
cd OpenPointer
```

> [!TIP]
> If you already cloned the repo without submodules, run the following to pull them now:
> ```powershell
> git submodule update --init --recursive
> ```

### 2. Install Monorepo Dependencies
We leverage local caching for optimal setup. Install packages and trigger workspace setup:

```powershell
npm install --cache .\.npm-cache
```

> [!NOTE]
> During the `postinstall` step, OpenPointer automatically applies a custom patch to `vendor/cua` (`patches/cua/0001-get-window-state-elements-structured-output.patch`) to enable deep, structured Windows element outputs.

### 3. Configure Local Environment Variables
Create your local configuration by copying the example environment file:

```powershell
copy .env.example .env
```

Open `.env` in your editor and configure your active backend. For example, to run with a local VLM (like Ollama or LM Studio):

```env
OP_AGENT_BACKEND=local-vlm

OP_LOCAL_VLM_ENABLED=true
OP_LOCAL_VLM_BASE_URL=http://127.0.0.1:11434/v1   # Local VLM endpoint (Ollama)
OP_LOCAL_VLM_MODEL=qwen2-vl                       # VLM Model name
OP_LOCAL_VLM_API_KEY=ollama                       # API Key (non-empty fallback)
```

Other adapters available in `.env` include `claude-agent`, `hermes`, `opencode`, and `codex`.

---

## 🚀 Running the Application

### Development Mode

Start the development build. This watches package dependencies, launches the Vite frontend server, and runs the Electron app:

```powershell
npm run dev
```

### Build for Production

Compile and bundle all TypeScript monorepo packages and the Electron app into highly optimized output files:

```powershell
npm run build
```

### Running Test Suites

Validate the gesture handlers, coordinate mappings, local VLMs, and API adapters via Vitest:

```powershell
npm run test
```

### Refreshing the CUA Driver for Team Debugging

When debugging Windows CUA grounding, refresh the patched native driver before
running tests:

```powershell
npm run test:cua
```

This command applies the local `patches/cua` patch set, builds the vendored
release driver, verifies that `get_window_state` returns structured elements
with bounding boxes, and then runs `npm test`.

You can also run the driver steps separately:

```powershell
npm run cua:prepare
npm run cua:verify
```

`npm test` intentionally does not rebuild Rust on every run. Use `test:cua`
when a change depends on the patched `cua-driver.exe`. The app resolves the
vendored release driver first, so teammates do not need a separate global driver
install for this path.

### Code Formatting & Type Checks

Verify typings across all packages and workspaces:

```powershell
npm run lint
```

---

## 📄 License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
