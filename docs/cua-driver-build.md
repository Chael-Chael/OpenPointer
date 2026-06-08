# Building the CUA Driver

OpenPointer's desktop element grounding relies on the **CUA driver** — a
Rust binary from the vendored [`trycua/cua`](https://github.com/trycua/cua)
submodule. OpenPointer pins setup to the `cua-driver-rs-v0.5.2` release and
talks to the driver's
Streamable HTTP MCP endpoint. The Electron main process starts `cua-driver serve`
with `CUA_DRIVER_RS_MCP_HTTP_PORT` and exposes only the OpenPointer broker MCP
server to agent backends.

The 0.5.2 baseline keeps the 0.5.x HTTP/session model and picks up the Windows
background-input fixes, including no-z-raise click/type behavior and DPI
awareness for the shipped binary.

Note: the official Windows 0.5.2 package currently reports `serverVersion` /
`cua-driver --version` as `0.5.1` because its Rust workspace metadata was not
bumped. OpenPointer's setup script checks the installed release directory so it
does not repeatedly reinstall the same 0.5.2 package.

This document covers building that binary so element selection works in
development and production.

## Prerequisites

- **OS**: Windows 10/11. The driver depends on Windows accessibility APIs.
- **Rust toolchain**: Install via [rustup](https://rustup.rs/). The MSVC
  toolchain (`stable-x86_64-pc-windows-msvc`) is recommended.
- **Git submodules**: The `vendor/cua` submodule must be initialized.

```powershell
git submodule update --init --recursive
```

## Apply the OpenPointer patches

The driver is patched to emit a structured `elements` array (control type,
name, bounding box, actions, selection state, and source) from
`get_window_state`. OpenPointer also adds a Windows `get_selected_text` tool for
clipboard-free UIA `TextPattern.GetSelection()` reads. These patches are applied
automatically during `npm install` via the `postinstall` script:

```
node scripts/setup-cua.mjs --patch-only
```

The setup script checks each patch in `patches/cua/*.patch` in filename order
and skips patches that are already applied. To apply the patch set manually:

```powershell
node scripts/setup-cua.mjs --patch-only
```

If a patch is already applied, that is expected — skip it.

## Build the binary

The driver crate lives at `vendor/cua/libs/cua-driver/rust`. Build it with
Cargo:

```powershell
# Debug build (faster compile, used during development)
cargo build --manifest-path vendor/cua/libs/cua-driver/rust/Cargo.toml

# Release build (optimized, used for packaging)
cargo build --release --manifest-path vendor/cua/libs/cua-driver/rust/Cargo.toml
```

The resulting binary is written to one of:

- `vendor/cua/libs/cua-driver/rust/target/debug/cua-driver.exe`
- `vendor/cua/libs/cua-driver/rust/target/release/cua-driver.exe`

## How the app finds the driver

`apps/desktop/src/main/cua-sidecar.ts` resolves the binary in this order:

1. The `OP_CUA_DRIVER_PATH` environment variable, if it points to an existing
   file. Use this to run a driver built somewhere else.
2. The vendored Cargo `release` then `debug` target directories listed above.
3. `cua-driver.exe` next to the packaged app resources (`process.resourcesPath`).
4. `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin\cua-driver.exe`.

On non-Windows platforms the binary name is `cua-driver` (no `.exe`), though the
accessibility features themselves are Windows-only.

OpenPointer does not use `cua-driver mcp` stdio. If HTTP startup fails, CUA is
reported unavailable instead of falling back to stdio.

### Overriding the path

```powershell
$env:OP_CUA_DRIVER_PATH = "C:\path\to\cua-driver.exe"
npm run dev
```

## Verifying the driver

With a build in place, start the app (`npm run dev`) and hover the pointer over
a native window. When grounding succeeds you will see element highlights. The
Settings panel shows the CUA HTTP status, endpoint, driver version, and tool
count. If grounding falls back, check the Electron main-process console for
`[op:cua]`-prefixed output from `cua-driver serve`.

Common failure modes:

| Symptom | Likely cause |
| --- | --- |
| `CUA driver binary not found` | Binary not built, or `OP_CUA_DRIVER_PATH` not set. |
| `CUA HTTP driver requires cua-driver serverVersion >= 0.5.1` | Installed driver is too old for OpenPointer's HTTP/session baseline. Run `npm run setup:cua` to install the pinned 0.5.2 release. |
| `No confident CUA window match` | The window under the cursor scored below the match threshold (e.g. the overlay or a background window). |
| `CUA matched a window but returned no usable elements` | The patch is not applied, so `get_window_state` returns no `elements` array. |
| `get_window_state reported an error` | The driver returned an MCP error; see the sidecar stderr for details. |

## Packaging

For production builds, copy the release binary next to the app resources so the
resolver finds it without an environment variable:

```powershell
cargo build --release --manifest-path vendor/cua/libs/cua-driver/rust/Cargo.toml
# Then include target/release/cua-driver.exe in the packaged resources directory.
```

The packaged app must include `cua-driver >= 0.5.2` so `cua-driver serve` works
with `CUA_DRIVER_RS_MCP_HTTP_PORT` and the Windows no-z-raise input path.
