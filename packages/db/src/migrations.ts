import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client.js';

export const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

export function hasMigrations(): boolean {
  return existsSync(resolve(MIGRATIONS_FOLDER, 'meta/_journal.json'));
}

/** Apply all pending migrations (idempotent; drizzle records applied ones). */
export async function runMigrations(db: Database): Promise<void> {
  if (!hasMigrations()) return;
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
