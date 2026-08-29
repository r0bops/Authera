import { describe, expect, it } from 'vitest';
import { testEnv } from '@authera/test-support';
import { ConfigError, loadConfig } from './config.js';

function expectConfigError(source: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(source);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected loadConfig to throw ConfigError');
}

describe('loadConfig', () => {
  it('applies the local defaults: mock payments, scripted agent, demo mode on', () => {
    const config = loadConfig(
      testEnv({ DEMO_MODE: undefined, PAYMENT_MODE: undefined, OPENAI_MODE: undefined }),
    );
    expect(config.payment).toEqual({ mode: 'mock' });
    expect(config.agent).toEqual({ mode: 'scripted', model: 'gpt-5-mini' });
    expect(config.demo).toEqual({
      enabled: true,
      resetSecret: 'test-demo-reset-secret',
      clockEnabled: false,
    });
    expect(config.port).toBe(0);
    expect(config.logLevel).toBe('silent');
    expect(config.publicBaseUrl).toBe('http://localhost:3000');
  });

  it('treats empty strings as unset', () => {
    const config = loadConfig(
      testEnv({ OPENAI_API_KEY: '', STRIPE_SECRET_KEY: '', WEB_DIST_DIR: '' }),
    );
    expect(config.webDistDir).toBeUndefined();
    expect(config.payment.mode).toBe('mock');
  });

  it('requires DATABASE_URL with a postgres scheme', () => {
    expect(expectConfigError(testEnv({ DATABASE_URL: undefined })).issues).toEqual([
      expect.objectContaining({ variable: 'DATABASE_URL' }),
    ]);
    const bad = expectConfigError(testEnv({ DATABASE_URL: 'mysql://user:pw@localhost/db' }));
    expect(bad.issues.map((issue) => issue.variable)).toEqual(['DATABASE_URL']);
  });

  it('rejects unknown modes', () => {
    expect(expectConfigError(testEnv({ PAYMENT_MODE: 'paypal' })).issues[0]?.variable).toBe(
      'PAYMENT_MODE',
    );
    expect(expectConfigError(testEnv({ OPENAI_MODE: 'anthropic' })).issues[0]?.variable).toBe(
      'OPENAI_MODE',
    );
    expect(expectConfigError(testEnv({ DEMO_MODE: 'yes' })).issues[0]?.variable).toBe('DEMO_MODE');
  });

  it('requires a Stripe test key only when PAYMENT_MODE=stripe', () => {
    const missing = expectConfigError(testEnv({ PAYMENT_MODE: 'stripe' }));
    expect(missing.issues.map((issue) => issue.variable)).toEqual(['STRIPE_SECRET_KEY']);

    const live = expectConfigError(
      testEnv({ PAYMENT_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_live_abc' }),
    );
    expect(live.issues.map((issue) => issue.variable)).toEqual(['STRIPE_SECRET_KEY']);

    const config = loadConfig(
      testEnv({
        PAYMENT_MODE: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_abc',
        STRIPE_WEBHOOK_SECRET: 'whsec_abc',
      }),
    );
    expect(config.payment).toEqual({
      mode: 'stripe',
      secretKey: 'sk_test_abc',
      webhookSecret: 'whsec_abc',
    });
  });

  it('requires OPENAI_API_KEY only when OPENAI_MODE=openai', () => {
    const error = expectConfigError(testEnv({ OPENAI_MODE: 'openai' }));
    expect(error.issues.map((issue) => issue.variable)).toEqual(['OPENAI_API_KEY']);

    const config = loadConfig(
      testEnv({ OPENAI_MODE: 'openai', OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-x' }),
    );
    expect(config.agent).toEqual({ mode: 'openai', model: 'gpt-x', apiKey: 'sk-test' });
  });

  it('requires DEMO_RESET_SECRET only while demo mode is enabled', () => {
    const error = expectConfigError(testEnv({ DEMO_MODE: 'true', DEMO_RESET_SECRET: undefined }));
    expect(error.issues.map((issue) => issue.variable)).toEqual(['DEMO_RESET_SECRET']);

    const config = loadConfig(testEnv({ DEMO_MODE: 'false', DEMO_RESET_SECRET: undefined }));
    expect(config.demo.enabled).toBe(false);
    expect(config.demo.resetSecret).toBeUndefined();
  });

  it('disables demo mode by default in production', () => {
    const config = loadConfig(
      testEnv({ NODE_ENV: 'production', DEMO_MODE: undefined, DEMO_RESET_SECRET: undefined }),
    );
    expect(config.nodeEnv).toBe('production');
    expect(config.demo.enabled).toBe(false);
  });

  it('refuses the .env.example placeholder session secret in production', () => {
    const error = expectConfigError(
      testEnv({
        NODE_ENV: 'production',
        SESSION_SECRET: 'replace-with-a-random-string-of-at-least-32-characters',
      }),
    );
    expect(error.issues.map((issue) => issue.variable)).toEqual(['SESSION_SECRET']);
  });

  it('never echoes secret values in error messages', () => {
    const secret = 'short-secret';
    const error = expectConfigError(testEnv({ SESSION_SECRET: secret }));
    expect(error.issues.map((issue) => issue.variable)).toEqual(['SESSION_SECRET']);
    expect(error.message).not.toContain(secret);
    expect(error.message).toContain('SESSION_SECRET');
  });

  it('coerces PORT and rejects non-numeric values', () => {
    expect(loadConfig(testEnv({ PORT: '8080' })).port).toBe(8080);
    expect(expectConfigError(testEnv({ PORT: 'eighty' })).issues[0]?.variable).toBe('PORT');
    expect(expectConfigError(testEnv({ PORT: '70000' })).issues[0]?.variable).toBe('PORT');
  });

  it('parses boolean flags and optional key material', () => {
    const config = loadConfig(
      testEnv({
        DEMO_CLOCK_ENABLED: 'true',
        AGENT_PRIVATE_JWK: '{"kty":"OKP"}',
        WEBAUTHN_ORIGIN: 'http://localhost:5173',
        WEBAUTHN_RP_ID: 'localhost',
      }),
    );
    expect(config.demo.clockEnabled).toBe(true);
    expect(config.keys.agentPrivateJwk).toBe('{"kty":"OKP"}');
    expect(config.keys.merchantPrivateJwk).toBeUndefined();
    expect(config.webauthn).toEqual({ rpId: 'localhost', origin: 'http://localhost:5173' });
  });
});
