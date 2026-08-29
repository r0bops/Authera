import { createDatabase, createPool } from './client.js';
import { hasMigrations, runMigrations } from './migrations.js';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to run migrations.');
    process.exit(1);
  }
  if (!hasMigrations()) {
    console.log('No migrations to apply yet.');
    return;
  }
  const pool = createPool(databaseUrl);
  try {
    await runMigrations(createDatabase(pool));
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
