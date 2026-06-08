#!/usr/bin/env node
// Reproducible CUA full-mode setup. Run on a fresh checkout in any environment:
//
//   npm run setup:cua
//
// It is idempotent and safe to re-run. Steps:
//   1. Ensure the vendor/cua submodule is initialised.
//   2. Apply OpenPointer's CUA driver patch set (skipped if already applied).
//   3. Download the pinned prebuilt cua-driver release binary (Windows/macOS/Linux).
//
// The downloaded release driver works with OpenPointer's release-compat
// grounding path (tree_markdown parsing). For pixel-precise element bounds you
// still need to compile the patched submodule with Rust + a C/C++ toolchain;
// pass --build to attempt that when cargo is available.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CUA_DRIVER_TARGET_VERSION = '0.5.2';
const wantBuild = process.argv.includes('--build');
const patchOnly = process.argv.includes('--patch-only');

function log(step, msg) {
  console.log(`\n[setup:cua] ${step}: ${msg}`);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: repoRoot, stdio: 'inherit', shell: false, ...opts });
  return res.status ?? 1;
}

function runQuiet(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', shell: false, ...opts });
  return { code: res.status ?? 1, out: (res.stdout || '') + (res.stderr || '') };
}

// Step 1: ensure the submodule is checked out.
function ensureSubmodule() {
  const marker = join(repoRoot, 'vendor', 'cua', 'libs', 'cua-driver', 'rust', 'Cargo.toml');
  if (existsSync(marker)) {
    log('submodule', 'vendor/cua already initialised.');
    return;
  }
  log('submodule', 'initialising vendor/cua ...');
  const code = run('git', ['submodule', 'update', '--init', '--recursive']);
  if (code !== 0) throw new Error('git submodule update failed.');
}

// Step 2: apply the CUA patches (idempotent).
function applyPatch(patchFile) {
  const patch = ['..', '..', 'patches', 'cua', patchFile].join('/');
  // --reverse --check succeeds when the patch is already applied.
  const already = runQuiet('git', ['-C', 'vendor/cua', 'apply', '--reverse', '--check', patch]);
  if (already.code === 0) {
    log('patch', `${patchFile} already applied.`);
    return;
  }
  const canApply = runQuiet('git', ['-C', 'vendor/cua', 'apply', '--check', patch]);
  if (canApply.code !== 0) {
    log('patch', `WARNING: ${patchFile} is not applicable (continuing). ${canApply.out.trim()}`);
    return;
  }
  const applied = runQuiet('git', ['-C', 'vendor/cua', 'apply', patch]);
  if (applied.code === 0) {
    log('patch', `${patchFile} applied.`);
  } else {
    log('patch', `WARNING: could not apply ${patchFile} (continuing). ${applied.out.trim()}`);
  }
}

function applyPatches() {
  const patchesDir = join(repoRoot, 'patches', 'cua');
  const patches = readdirSync(patchesDir)
    .filter((name) => name.endsWith('.patch'))
    .sort((a, b) => a.localeCompare(b));
  for (const patch of patches) applyPatch(patch);
}

// Step 3: download the prebuilt cua-driver release binary.
function installedDriverPath() {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    const driver = local ? join(local, 'Programs', 'Cua', 'cua-driver', 'bin', 'cua-driver.exe') : '';
    return driver && existsSync(driver) ? driver : undefined;
  }
  const home = process.env.HOME || '';
  const driver = join(home, '.cua-driver', 'packages', 'current', 'cua-driver');
  return existsSync(driver) ? driver : undefined;
}

function installedDriverVersion(driverPath) {
  if (!driverPath) return undefined;
  const version = runQuiet(driverPath, ['--version']);
  if (version.code !== 0) return undefined;
  return /cua-driver\s+(\d+\.\d+\.\d+)/.exec(version.out)?.[1];
}

function installedDriverReleaseVersion(driverPath) {
  if (!driverPath) return undefined;
  try {
    const resolved = realpathSync(driverPath);
    return /[\\/]releases[\\/](\d+\.\d+\.\d+)-/.exec(resolved)?.[1];
  } catch {
    return undefined;
  }
}

function isAtLeastVersion(actual, required) {
  const a = actual.split('.').map((part) => Number.parseInt(part, 10));
  const r = required.split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(a.length, r.length); index += 1) {
    const av = Number.isFinite(a[index]) ? a[index] : 0;
    const rv = Number.isFinite(r[index]) ? r[index] : 0;
    if (av > rv) return true;
    if (av < rv) return false;
  }
  return true;
}

function installDriver() {
  const currentDriver = installedDriverPath();
  const currentVersion = installedDriverVersion(currentDriver);
  const currentReleaseVersion = installedDriverReleaseVersion(currentDriver);
  if (
    (currentVersion && isAtLeastVersion(currentVersion, CUA_DRIVER_TARGET_VERSION)) ||
    (currentReleaseVersion && isAtLeastVersion(currentReleaseVersion, CUA_DRIVER_TARGET_VERSION))
  ) {
    const suffix = currentReleaseVersion && currentVersion !== currentReleaseVersion ? ` (binary reports ${currentVersion ?? 'unknown'})` : '';
    log('driver', `cua-driver release ${currentReleaseVersion ?? currentVersion} already installed${suffix}.`);
    return;
  }
  const scriptsDir = join(repoRoot, 'vendor', 'cua', 'libs', 'cua-driver', 'scripts');
  if (process.platform === 'win32') {
    const ps1 = join(scriptsDir, 'install.ps1');
    log('driver', `installing prebuilt cua-driver ${CUA_DRIVER_TARGET_VERSION} (Windows) ...`);
    const code = run('powershell', ['-ExecutionPolicy', 'Bypass', '-File', ps1, '-Release', CUA_DRIVER_TARGET_VERSION, '-NoAutoStart', '-NoPathUpdate']);
    if (code !== 0) log('driver', 'WARNING: install.ps1 exited non-zero; check output above.');
  } else {
    const sh = join(scriptsDir, 'install.sh');
    log('driver', `installing prebuilt cua-driver ${CUA_DRIVER_TARGET_VERSION} (Unix) ...`);
    const code = run('bash', [sh], { env: { ...process.env, CUA_DRIVER_RS_VERSION: CUA_DRIVER_TARGET_VERSION } });
    if (code !== 0) log('driver', 'WARNING: install.sh exited non-zero; check output above.');
  }
}

// Optional: compile the patched driver for pixel-precise element bounds.
function resolveUserCargo() {
  const exe = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  const candidates = [
    'cargo',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.cargo', 'bin', exe) : '',
    process.env.HOME ? join(process.env.HOME, '.cargo', 'bin', exe) : ''
  ].filter(Boolean);
  return candidates.find((candidate) => {
    if (candidate !== 'cargo' && !existsSync(candidate)) return false;
    return runQuiet(candidate, ['--version']).code === 0;
  });
}

function hasMsvcLinker() {
  if (process.platform !== 'win32') return true;
  const link = runQuiet('where', ['link.exe']);
  return link.code === 0;
}

function resolveVsDevCmd() {
  if (process.platform !== 'win32') return undefined;
  const vswhere = join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe'
  );
  const candidates = [];
  if (existsSync(vswhere)) {
    const found = runQuiet(vswhere, [
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-latest',
      '-property',
      'installationPath'
    ]);
    const installPath = found.out.trim();
    if (found.code === 0 && installPath) {
      candidates.push(join(installPath, 'Common7', 'Tools', 'VsDevCmd.bat'));
    }
  }
  candidates.push(
    join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Microsoft Visual Studio',
      '2022',
      'BuildTools',
      'Common7',
      'Tools',
      'VsDevCmd.bat'
    )
  );
  return candidates.find((candidate) => existsSync(candidate));
}

function buildDriver() {
  const cargoBin = resolveUserCargo();
  if (!cargoBin) {
    log('build', 'cargo not found; skipping native build. Install Rust + a C/C++ toolchain to enable precise bounds.');
    return;
  }
  const cargo = runQuiet(cargoBin, ['--version']);
  log('build', `compiling patched cua-driver with ${cargo.out.trim()} ...`);
  const rustDir = join('vendor', 'cua', 'libs', 'cua-driver', 'rust');
  const rustPath = join(repoRoot, rustDir);
  let code;
  if (process.platform === 'win32' && !hasMsvcLinker()) {
    const vsDevCmd = resolveVsDevCmd();
    if (!vsDevCmd) {
      log(
        'build',
        'MSVC linker link.exe not found; skipping native build. Install Visual Studio Build Tools with the Desktop development with C++ workload, then rerun `npm run setup:cua -- --build`.'
      );
      return;
    }
    log('build', 'link.exe is not in PATH; building via Visual Studio developer environment.');
    code = run('cmd.exe', ['/d', '/c', 'call', vsDevCmd, '-arch=x64', '-host_arch=x64', '&&', cargoBin, 'build', '--release'], {
      cwd: rustPath
    });
  } else {
    code = run(cargoBin, ['build', '--release'], { cwd: rustPath });
  }
  log('build', code === 0 ? 'native driver built.' : 'WARNING: cargo build failed; release binary still usable.');
}

function main() {
  try {
    ensureSubmodule();
    applyPatches();
    if (patchOnly) {
      log('done', 'CUA patch check complete.');
      return;
    }
    installDriver();
    if (wantBuild) buildDriver();
    log('done', `CUA setup complete with cua-driver ${CUA_DRIVER_TARGET_VERSION}. Set OP_CUA_MODE=prefer (or use the in-app setting) and run \`npm run dev\`.`);
  } catch (error) {
    console.error(`\n[setup:cua] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
