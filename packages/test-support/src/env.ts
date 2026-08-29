export type EnvSource = Record<string, string | undefined>;

/**
 * A complete, valid environment for tests. Override or delete keys per test case.
 * Values are obviously fake; the database URL points at a port nothing listens on.
 */
export function testEnv(overrides: EnvSource = {}): EnvSource {
  return {
    NODE_ENV: 'test',
    PORT: '0',
    DATABASE_URL: 'postgres://agentcerta:agentcerta@127.0.0.1:1/agentcerta_test',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    LOG_LEVEL: 'silent',
    SESSION_SECRET: 'test-session-secret-0123456789abcdef0123456789',
    DEMO_MODE: 'true',
    DEMO_RESET_SECRET: 'test-demo-reset-secret',
    PAYMENT_MODE: 'mock',
    OPENAI_MODE: 'scripted',
    ...overrides,
  };
}
