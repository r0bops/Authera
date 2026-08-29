import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Load the nearest `.env` (walking up from `startDir`) outside production.
 * Uses Node's built-in parser; variables already present in the environment win.
 * Returns the loaded path, or undefined when nothing was loaded.
 */
export function loadDotEnv(startDir: string = process.cwd()): string | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;

  let dir = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
