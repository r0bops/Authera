import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client.js';

const migrationCandidates = [
  process.env.MIGRATIONS_DIR,
  resolve(dirname(fileURLToPath(import.meta.url)), '../migrations'),
  resolve(process.cwd(), 'packages/db/migrations'),
].filter((candidate): candidate is string => Boolean(candidate));

export const MIGRATIONS_FOLDER =
  migrationCandidates.find((candidate) => existsSync(resolve(candidate, 'meta/_journal.json'))) ??
  migrationCandidates[0]!;

export function hasMigrations(): boolean {
  return existsSync(resolve(MIGRATIONS_FOLDER, 'meta/_journal.json'));
}

/** Apply all pending migrations (idempotent; drizzle records applied ones). */
export async function runMigrations(db: Database): Promise<void> {
  if (!hasMigrations()) return;
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
