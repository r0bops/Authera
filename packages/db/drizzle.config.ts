import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://agentcerta:agentcerta@localhost:5432/agentcerta',
  },
  strict: true,
  verbose: true,
});
