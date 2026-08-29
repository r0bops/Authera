import { createRequire } from 'node:module';

type RuntimeSchema<T> = { parse(value: unknown): T };
type UcpSdk = {
  CapabilityDiscoverySchema: RuntimeSchema<{
    name: string;
    version: string;
    spec: string;
    schema: string;
    config?: Record<string, unknown>;
    extends?: string;
  }>;
  ServiceResponseSchema: RuntimeSchema<{
    version: string;
    transport: 'a2a' | 'embedded' | 'mcp' | 'rest';
    spec?: string;
    schema?: string;
    endpoint?: string;
    id?: string;
    config?: Record<string, unknown>;
  }>;
};

// @ucp-js/sdk 0.4.6 publishes extensionless ESM imports that Node cannot resolve. Its CJS export
// is valid, so keep the compatibility workaround at this single integration boundary.
const sdk = createRequire(import.meta.url)('@ucp-js/sdk') as UcpSdk;

export const { CapabilityDiscoverySchema, ServiceResponseSchema } = sdk;
