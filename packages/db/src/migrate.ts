import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createPool } from './client.js';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to run migrations.');
    process.exit(1);
  }

  if (!existsSync(resolve(migrationsFolder, 'meta/_journal.json'))) {
    console.log('No migrations to apply yet (Phase 2 generates the first migration).');
    return;
  }

  const pool = createPool(databaseUrl);
  try {
    await migrate(drizzle(pool), { migrationsFolder });
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
