import { createDatabase, createPool } from './client.js';
import { requireDatabaseUrl, seedInputFromEnv } from './cli-common.js';
import { runMigrations } from './migrations.js';
import { seedDemo } from './seed.js';

async function main(): Promise<void> {
  const pool = createPool(requireDatabaseUrl());
  try {
    const db = createDatabase(pool);
    await runMigrations(db);
    const { seed, keys } = seedInputFromEnv();
    await seedDemo(db, seed);
    console.log(
      `Seeded demo data (agent key ${keys.agent.thumbprint.slice(0, 12)}…${keys.derived ? ', demo-derived keys' : ''}).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
