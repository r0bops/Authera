import { loadKeyMaterial, type KeyMaterial } from '@agentcerta/domain';
import type { SeedInput } from './seed.js';

/** Build seed input from environment variables (used by the seed and reset CLIs). */
export function seedInputFromEnv(env: NodeJS.ProcessEnv = process.env): {
  seed: SeedInput;
  keys: KeyMaterial;
} {
  const keys = loadKeyMaterial({
    trustedSurfacePrivateJwk: env.TRUSTED_SURFACE_PRIVATE_JWK || undefined,
    merchantPrivateJwk: env.MERCHANT_PRIVATE_JWK || undefined,
    agentPrivateJwk: env.AGENT_PRIVATE_JWK || undefined,
    demoSecret: env.DEMO_RESET_SECRET || undefined,
  });
  return {
    keys,
    seed: {
      publicBaseUrl: env.PUBLIC_BASE_URL || 'http://localhost:3000',
      keys: {
        trustedSurface: { kid: keys.trustedSurface.kid, publicJwk: keys.trustedSurface.publicJwk },
        merchant: { kid: keys.merchant.kid, publicJwk: keys.merchant.publicJwk },
        agent: { thumbprint: keys.agent.thumbprint, publicJwk: keys.agent.publicJwk },
      },
    },
  };
}

export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  return url;
}
