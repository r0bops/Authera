import { describe, expect, it } from 'vitest';
import { loadKeyMaterial } from '@agentcerta/domain';
import { CapabilityDiscoverySchema, ServiceResponseSchema } from '../../integrations/ucp-sdk.js';
import { buildUcpDiscoveryProfile, UCP_VERSION } from './discovery.js';

describe('UCP 2026-04-08 discovery contract', () => {
  it('advertises the pinned REST checkout service and merchant signing key', () => {
    const keys = loadKeyMaterial({ demoSecret: 'ucp-discovery-test' });
    const profile = buildUcpDiscoveryProfile({
      publicBaseUrl: 'https://merchant.example/',
      merchantKey: keys.merchant,
    });

    expect(UCP_VERSION).toBe('2026-04-08');
    expect(ServiceResponseSchema.parse(profile.ucp.services['dev.ucp.shopping'][0])).toMatchObject({
      version: UCP_VERSION,
      transport: 'rest',
      endpoint: 'https://merchant.example/ucp/v1',
    });
    expect(
      CapabilityDiscoverySchema.parse(profile.ucp.capabilities['dev.ucp.shopping.checkout'][0]),
    ).toMatchObject({ name: 'dev.ucp.shopping.checkout', version: UCP_VERSION });
    expect(profile.signing_keys).toEqual([
      expect.objectContaining({
        kid: keys.merchant.thumbprint,
        kty: 'OKP',
        crv: 'Ed25519',
        use: 'sig',
      }),
    ]);
  });

  it('binds official dev.ucp names to ucp.dev specification origins', () => {
    const profile = buildUcpDiscoveryProfile({
      publicBaseUrl: 'https://merchant.example',
      merchantKey: loadKeyMaterial({ demoSecret: 'ucp-origin-test' }).merchant,
    });
    const capability = profile.ucp.capabilities['dev.ucp.shopping.checkout'][0]!;
    expect(new URL(capability.spec).origin).toBe('https://ucp.dev');
    expect(new URL(capability.schema).origin).toBe('https://ucp.dev');
  });
});
