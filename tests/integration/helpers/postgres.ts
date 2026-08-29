import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createDatabase,
  createPool,
  runMigrations,
  seedDemo,
  type Database,
  type DatabasePool,
  type SeedInput,
} from '@agentcerta/db';
import { loadKeyMaterial, type KeyMaterial } from '@agentcerta/domain';

export const POSTGRES_IMAGE = 'postgres:18-alpine';
export const TEST_DEMO_SECRET = 'integration-test-demo-secret';

export interface TestPostgres {
  container: StartedPostgreSqlContainer;
  pool: DatabasePool;
  db: Database;
  keys: KeyMaterial;
  seed: SeedInput;
  stop: () => Promise<void>;
}

export function testKeys(): { keys: KeyMaterial; seed: SeedInput } {
  const keys = loadKeyMaterial({ demoSecret: TEST_DEMO_SECRET });
  return {
    keys,
    seed: {
      publicBaseUrl: 'http://localhost:3000',
      keys: {
        trustedSurface: { kid: keys.trustedSurface.kid, publicJwk: keys.trustedSurface.publicJwk },
        merchant: { kid: keys.merchant.kid, publicJwk: keys.merchant.publicJwk },
        agent: { thumbprint: keys.agent.thumbprint, publicJwk: keys.agent.publicJwk },
      },
    },
  };
}

/** Start a real PostgreSQL 18, migrate, and seed the deterministic demo scenario. */
export async function startTestPostgres(): Promise<TestPostgres> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const pool = createPool(container.getConnectionUri(), { max: 20 });
  const db = createDatabase(pool);
  await runMigrations(db);
  const { keys, seed } = testKeys();
  await seedDemo(db, seed);
  return {
    container,
    pool,
    db,
    keys,
    seed,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
