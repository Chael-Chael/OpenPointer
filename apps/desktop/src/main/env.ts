import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function loadLocalEnv(cwd: string): void {
  const envPath = findUp(cwd, '.env') ?? resolve(cwd, '.env');
  if (!existsSync(envPath)) return;
  console.log('[omp] loading env', envPath);
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

export function findUp(startDir: string, fileName: string): string | null {
  let current = resolve(startDir);
  while (true) {
    const candidate = join(current, fileName);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
