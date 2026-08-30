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
    PAYMENT_MODE: z.enum(['mock', 'stripe']).default('mock'),
    OPENAI_MODE: z.enum(['scripted', 'openai']).default('scripted'),
    OPENAI_API_KEY: optionalSecret,
    OPENAI_MODEL: z.string().min(1).default('gpt-5-mini'),
    /** Stripe test-mode secret (sk_test_…); required when PAYMENT_MODE=stripe. */
    STRIPE_SECRET_KEY: optionalSecret,
    /** Stripe webhook signing secret (whsec_…); without it /webhooks/stripe rejects everything. */
    STRIPE_WEBHOOK_SECRET: optionalSecret,
    /** Optional: enables the live Duffel flight market (test-mode token is fine). */
    DUFFEL_ACCESS_TOKEN: optionalSecret,
    /** Sandbox fares are synthetic: 'region' prices them with Authera's region model (labelled). */
    DUFFEL_TEST_PRICE_MODEL: z.enum(['off', 'region']).default('off'),
    /** When a watched route gains an offer inside a plan, let the agent attempt it at once. */
    PRICE_WATCH_AUTO_BUY: booleanString.default('true'),
    /** Routes kept fresh even with no plan on them, so fares exist before anyone asks. */
    PRICE_WATCH_WARM_ROUTES: z.string().default('CCS-COR,BOG-MDE,EZE-COR,BOG-COR'),
    /** Background discovery cadence per active mandate; 0 disables the price watcher. */
    PRICE_WATCH_INTERVAL_MS: z.coerce.number().int().min(0).default(300_000),
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

    if (env.PAYMENT_MODE === 'stripe') {
      require('STRIPE_SECRET_KEY', 'when PAYMENT_MODE=stripe');
      if (env.STRIPE_SECRET_KEY && !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) {
        ctx.addIssue({
          code: 'custom',
          path: ['STRIPE_SECRET_KEY'],
          message: 'must be a test-mode key (sk_test_…) for this build',
        });
      }
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
  { mode: 'mock' } | { mode: 'stripe'; secretKey: string; webhookSecret: string | undefined };

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
  markets: {
    duffel: { accessToken: string } | undefined;
    /** Milliseconds between market searches per active mandate; 0 = off. */
    priceWatchIntervalMs: number;
    /** The watcher hands an eligible new offer to the agent (one attempt per offer). */
    priceWatchAutoBuy: boolean;
    /** Region-calibrated pricing for sandbox inventory; never applies to live mode. */
    duffelPriceModel: 'off' | 'region';
    /** Origin/destination pairs searched on a schedule regardless of plans. */
    priceWatchWarmRoutes: Array<{ origin: string; destination: string }>;
  };
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
    env.PAYMENT_MODE === 'stripe'
      ? {
          mode: 'stripe',
          // superRefine guarantees presence; the assertion keeps the types honest.
          secretKey: mustHave(env.STRIPE_SECRET_KEY),
          webhookSecret: env.STRIPE_WEBHOOK_SECRET,
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
      priceWatchIntervalMs: env.PRICE_WATCH_INTERVAL_MS,
      priceWatchAutoBuy: env.PRICE_WATCH_AUTO_BUY === 'true',
      duffelPriceModel: env.DUFFEL_TEST_PRICE_MODEL,
      priceWatchWarmRoutes: env.PRICE_WATCH_WARM_ROUTES.split(',')
        .map((pair) => pair.trim().toUpperCase())
        .filter((pair) => /^[A-Z]{3}-[A-Z]{3}$/.test(pair))
        .map((pair) => ({ origin: pair.slice(0, 3), destination: pair.slice(4, 7) })),
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
