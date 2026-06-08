#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
const driverPath = join(repoRoot, 'vendor', 'cua', 'libs', 'cua-driver', 'rust', 'target', 'release', exe);

function log(step, msg) {
  console.log(`[verify:cua] ${step}: ${msg}`);
}

function runDriver(args, input) {
  const res = spawnSync(driverPath, args, {
    cwd: repoRoot,
    input,
    encoding: 'utf8',
    env: { ...process.env, CUA_DRIVER_RS_UPDATE_CHECK: 'false' }
  });
  return {
    code: res.status ?? 1,
    out: (res.stdout || '').replace(/^\uFEFF/, '').trim(),
    err: (res.stderr || '').trim()
  };
}

function callTool(name, args = {}) {
  const res = runDriver(['call', name, '--json'], JSON.stringify(args));
  if (res.code !== 0) {
    throw new Error(`${name} failed: ${res.err || res.out || `exit ${res.code}`}`);
  }
  try {
    return JSON.parse(res.out);
  } catch (error) {
    throw new Error(`${name} returned non-JSON output: ${res.out || res.err || String(error)}`);
  }
}

function windowBounds(record) {
  return record.bounds ?? {
    x: record.x,
    y: record.y,
    width: record.width,
    height: record.height
  };
}

function isUsableWindow(record) {
  const bounds = windowBounds(record);
  const title = String(record.title ?? '');
  if (title.includes('Cua.AgentCursorOverlay')) return false;
  return Number(record.pid) > 0 && Number(record.window_id) > 0 && Number(bounds.width) > 120 && Number(bounds.height) > 80;
}

function main() {
  if (!existsSync(driverPath)) {
    throw new Error(`vendored release driver not found: ${driverPath}. Run npm run cua:prepare first.`);
  }

  // Avoid verifying against an older daemon that still owns the default pipe.
  runDriver(['stop']);

  const version = runDriver(['--version']);
  if (version.code === 0) log('driver', `${driverPath} (${version.out})`);

  const listWindows = callTool('list_windows');
  const windows = listWindows.windows ?? listWindows._legacy_windows ?? [];
  const candidates = windows.filter(isUsableWindow);
  if (candidates.length === 0) {
    throw new Error('list_windows returned no usable visible windows to probe.');
  }

  for (const candidate of candidates.slice(0, 12)) {
    const state = callTool('get_window_state', {
      pid: Number(candidate.pid),
      window_id: Number(candidate.window_id),
      capture_mode: 'ax'
    });
    const elements = Array.isArray(state.elements) ? state.elements : [];
    const elementsWithRect = elements.filter((element) => element.rect).length;
    if (elements.length > 0 && elementsWithRect > 0) {
      log(
        'ok',
        `structured elements available for "${candidate.title || candidate.app_name || candidate.window_id}": ${elements.length} elements, ${elementsWithRect} with rect.`
      );
      return;
    }
  }

  throw new Error('get_window_state did not return structured elements with rect for any probed window.');
}

try {
  main();
} catch (error) {
  console.error(`[verify:cua] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
