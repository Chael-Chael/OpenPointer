/**
 * Windows-specific helper to aggressively steal OS-level keyboard focus.
 *
 * Electron's `BrowserWindow.focus()` calls `SetForegroundWindow`, but Windows
 * blocks that call unless the calling process already *is* the foreground
 * process.  The standard workaround is `AttachThreadInput` – temporarily
 * attach our thread to the current foreground thread, which lets
 * `SetForegroundWindow` succeed, then detach.
 *
 * On non-Windows platforms this module is a no-op.
 */
import koffi from 'koffi';

const isWindows = process.platform === 'win32';

let SetForegroundWindow: ((hWnd: number) => number) | null = null;
let GetForegroundWindow: (() => number) | null = null;
let GetWindowThreadProcessId: ((hWnd: number, lpdwProcessId: number[]) => number) | null = null;
let AttachThreadInput: ((idAttach: number, idAttachTo: number, fAttach: number) => number) | null = null;
let GetCurrentThreadId: (() => number) | null = null;

if (isWindows) {
  try {
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');

    SetForegroundWindow = user32.func('int SetForegroundWindow(int64 hWnd)');
    GetForegroundWindow = user32.func('int64 GetForegroundWindow()');
    GetWindowThreadProcessId = user32.func('uint GetWindowThreadProcessId(int64 hWnd, _Out_ uint *lpdwProcessId)');
    AttachThreadInput = user32.func('int AttachThreadInput(uint idAttach, uint idAttachTo, int fAttach)');
    GetCurrentThreadId = kernel32.func('uint GetCurrentThreadId()');
  } catch {
    // Fallback: native FFI unavailable (e.g. ARM64 build, missing DLL)
  }
}

/**
 * Force the given Electron BrowserWindow to become the foreground window on
 * Windows using the AttachThreadInput trick.  Returns `true` if the call
 * succeeded (or on non-Windows).
 */
export function forceForeground(win: Electron.BrowserWindow): boolean {
  if (!isWindows || !SetForegroundWindow || win.isDestroyed()) return false;

  // getNativeWindowHandle() returns an 8-byte LE buffer; HWND fits in 6 bytes.
  const hWnd = win.getNativeWindowHandle().readIntLE(0, 6);
  if (!hWnd) return false;

  const fgWnd = GetForegroundWindow!();

  // Already foreground – nothing to do.
  if (fgWnd === hWnd) return true;

  // Attach to the current foreground thread so Windows lets us steal focus.
  const fgThread = GetWindowThreadProcessId!(fgWnd, [0]);
  const ourThread = GetCurrentThreadId!();
  const attached = fgThread !== 0 && fgThread !== ourThread
    ? AttachThreadInput!(ourThread, fgThread, 1)
    : 0;

  const ok = SetForegroundWindow!(hWnd);

  if (attached) AttachThreadInput!(ourThread, fgThread, 0);

  return ok !== 0;
}
