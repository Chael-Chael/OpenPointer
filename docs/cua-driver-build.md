# Building the CUA Driver

OpenMagicPointer's desktop element grounding relies on the **CUA driver** — a
Rust binary from the vendored [`trycua/cua`](https://github.com/trycua/cua)
submodule. The driver exposes Windows UI Automation (UIA/MSAA) data over an MCP
(`stdio`) interface, which the Electron main process spawns as a sidecar
(`cua-driver mcp`).

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

## Apply the structured-output patch

The driver is patched to emit a structured `elements` array (control type,
name, bounding box, actions, and source) from `get_window_state`. This patch is
applied automatically during `npm install` via the `postinstall` script:

```
git -C vendor/cua apply ../../patches/cua/0001-get-window-state-elements-structured-output.patch || exit 0
```

The `|| exit 0` means a failed apply (for example, the patch is already
applied) does not abort install. To apply it manually:

```powershell
git -C vendor/cua apply patches/cua/0001-get-window-state-elements-structured-output.patch
```

If the patch fails because it was already applied, that is expected — skip it.

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

1. The `OMP_CUA_DRIVER_PATH` environment variable, if it points to an existing
   file. Use this to run a driver built somewhere else.
2. `cua-driver.exe` next to the packaged app resources (`process.resourcesPath`).
3. `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin\cua-driver.exe`.
4. The Cargo `debug` then `release` target directories listed above.

On non-Windows platforms the binary name is `cua-driver` (no `.exe`), though the
accessibility features themselves are Windows-only.

### Overriding the path

```powershell
$env:OMP_CUA_DRIVER_PATH = "C:\path\to\cua-driver.exe"
npm run dev
```

## Verifying the driver

With a build in place, start the app (`npm run dev`) and hover the pointer over
a native window. When grounding succeeds you will see element highlights. If
grounding falls back, check the Electron main-process console for
`[omp:cua]`-prefixed stderr output from the sidecar.

Common failure modes:

| Symptom | Likely cause |
| --- | --- |
| `CUA driver binary not found` | Binary not built, or `OMP_CUA_DRIVER_PATH` not set. |
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
