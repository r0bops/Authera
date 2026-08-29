import { z } from 'zod';

/**
 * Validated environment configuration (CLAUDE_IMPLEMENTATION_SPEC.md §19).
 *
 * Rules:
 * - Secrets for an integration are required only when that integration mode is enabled.
 * - Local defaults are PAYMENT_MODE=mock, OPENAI_MODE=scripted, DEMO_MODE=true.
 * - DEMO_MODE defaults to false in production (demo routes disabled by default).
 * - Errors list variable names and problems, never values.
 */

const booleanString = z.enum(['true', 'false']);
const optionalSecret = z.string().min(1).optional();

const PLACEHOLDER_PREFIX = 'replace-with';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine((value) => /^postgres(ql)?:\/\//.test(value), {
        message: 'must be a postgres:// or postgresql:// connection URL',
      }),
    PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    SESSION_SECRET: z.string().min(32, { message: 'must be at least 32 characters' }),
    DEMO_MODE: booleanString.optional(),
    DEMO_RESET_SECRET: z.string().min(16, { message: 'must be at least 16 characters' }).optional(),
    DEMO_CLOCK_ENABLED: booleanString.default('false'),
    PAYMENT_MODE: z.enum(['mock', 'yuno']).default('mock'),
    OPENAI_MODE: z.enum(['scripted', 'openai']).default('scripted'),
    OPENAI_API_KEY: optionalSecret,
    OPENAI_MODEL: z.string().min(1).default('gpt-5-mini'),
    YUNO_PUBLIC_API_KEY: optionalSecret,
    YUNO_PRIVATE_SECRET_KEY: optionalSecret,
    YUNO_ACCOUNT_ID: optionalSecret,
    YUNO_WEBHOOK_SECRET: optionalSecret,
    /** Optional: enables the live Duffel flight market (test-mode token is fine). */
    DUFFEL_ACCESS_TOKEN: optionalSecret,
    TRUSTED_SURFACE_PRIVATE_JWK: optionalSecret,
    MERCHANT_PRIVATE_JWK: optionalSecret,
    AGENT_PRIVATE_JWK: optionalSecret,
    WEBAUTHN_RP_ID: z.string().min(1).optional(),
    WEBAUTHN_ORIGIN: z.url().optional(),
    WEB_DIST_DIR: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    const require = (key: keyof typeof env, reason: string) => {
      if (env[key] === undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: `is required ${reason}` });
      }
    };

    if (env.PAYMENT_MODE === 'yuno') {
      require('YUNO_PUBLIC_API_KEY', 'when PAYMENT_MODE=yuno');
      require('YUNO_PRIVATE_SECRET_KEY', 'when PAYMENT_MODE=yuno');
      require('YUNO_ACCOUNT_ID', 'when PAYMENT_MODE=yuno');
      require('YUNO_WEBHOOK_SECRET', 'when PAYMENT_MODE=yuno');
    }
    if (env.OPENAI_MODE === 'openai') {
      require('OPENAI_API_KEY', 'when OPENAI_MODE=openai');
    }

    const demoEnabled = resolveDemoMode(env.DEMO_MODE, env.NODE_ENV);
    if (demoEnabled) {
      require('DEMO_RESET_SECRET', 'when DEMO_MODE=true');
    }

    if (env.NODE_ENV === 'production' && env.SESSION_SECRET.startsWith(PLACEHOLDER_PREFIX)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'must not be the .env.example placeholder in production',
      });
    }
  });

type ParsedEnv = z.infer<typeof envSchema>;

export type NodeEnv = ParsedEnv['NODE_ENV'];
export type LogLevel = ParsedEnv['LOG_LEVEL'];

export type PaymentConfig =
  | { mode: 'mock' }
  | {
      mode: 'yuno';
      publicApiKey: string;
      privateSecretKey: string;
      accountId: string;
      webhookSecret: string;
    };

export type AgentConfig =
  { mode: 'scripted'; model: string } | { mode: 'openai'; model: string; apiKey: string };

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  databaseUrl: string;
  publicBaseUrl: string;
  logLevel: LogLevel;
  sessionSecret: string;
  demo: { enabled: boolean; resetSecret: string | undefined; clockEnabled: boolean };
  payment: PaymentConfig;
  agent: AgentConfig;
  /** External flight markets; each is optional and fails open (search continues without it). */
  markets: { duffel: { accessToken: string } | undefined };
  keys: {
    trustedSurfacePrivateJwk: string | undefined;
    merchantPrivateJwk: string | undefined;
    agentPrivateJwk: string | undefined;
  };
  webauthn: { rpId: string | undefined; origin: string | undefined };
  /** Explicit override for the compiled SPA directory served by the API. */
  webDistDir: string | undefined;
}

export class ConfigError extends Error {
  readonly issues: ReadonlyArray<{ variable: string; message: string }>;

  constructor(issues: ReadonlyArray<{ variable: string; message: string }>) {
    super(
      `Invalid environment configuration:\n${issues
        .map((issue) => `  - ${issue.variable}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export type EnvSource = Record<string, string | undefined>;

/**
 * Parse and validate configuration from an environment-like source.
 * Empty strings are treated as unset so `.env` files with blank placeholders work.
 * Throws ConfigError (variable names and problems only) on failure.
 */
export function loadConfig(source: EnvSource = process.env): AppConfig {
  const input: EnvSource = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') input[key] = value;
  }

  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => ({
        variable: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
  return toAppConfig(parsed.data);
}

function resolveDemoMode(value: 'true' | 'false' | undefined, nodeEnv: NodeEnv): boolean {
  if (value !== undefined) return value === 'true';
  return nodeEnv !== 'production';
}

function toAppConfig(env: ParsedEnv): AppConfig {
  const payment: PaymentConfig =
    env.PAYMENT_MODE === 'yuno'
      ? {
          mode: 'yuno',
          // superRefine guarantees presence; the assertions keep the types honest.
          publicApiKey: mustHave(env.YUNO_PUBLIC_API_KEY),
          privateSecretKey: mustHave(env.YUNO_PRIVATE_SECRET_KEY),
          accountId: mustHave(env.YUNO_ACCOUNT_ID),
          webhookSecret: mustHave(env.YUNO_WEBHOOK_SECRET),
        }
      : { mode: 'mock' };

  const agent: AgentConfig =
    env.OPENAI_MODE === 'openai'
      ? { mode: 'openai', model: env.OPENAI_MODEL, apiKey: mustHave(env.OPENAI_API_KEY) }
      : { mode: 'scripted', model: env.OPENAI_MODEL };

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    logLevel: env.LOG_LEVEL,
    sessionSecret: env.SESSION_SECRET,
    demo: {
      enabled: resolveDemoMode(env.DEMO_MODE, env.NODE_ENV),
      resetSecret: env.DEMO_RESET_SECRET,
      clockEnabled: env.DEMO_CLOCK_ENABLED === 'true',
    },
    payment,
    agent,
    markets: {
      duffel: env.DUFFEL_ACCESS_TOKEN ? { accessToken: env.DUFFEL_ACCESS_TOKEN } : undefined,
    },
    keys: {
      trustedSurfacePrivateJwk: env.TRUSTED_SURFACE_PRIVATE_JWK,
      merchantPrivateJwk: env.MERCHANT_PRIVATE_JWK,
      agentPrivateJwk: env.AGENT_PRIVATE_JWK,
    },
    webauthn: { rpId: env.WEBAUTHN_RP_ID, origin: env.WEBAUTHN_ORIGIN },
    webDistDir: env.WEB_DIST_DIR,
  };
}

function mustHave(value: string | undefined): string {
  if (value === undefined) {
    throw new ConfigError([{ variable: '(internal)', message: 'validated value missing' }]);
  }
  return value;
}
