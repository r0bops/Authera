import { z } from 'zod';
import { apiResultSchema } from './common.js';

export const HEALTH_ROUTES = {
  live: '/health/live',
  ready: '/health/ready',
} as const;

/** Result of one readiness probe. Errors are short descriptions, never connection strings. */
export const ReadinessCheckSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), latencyMs: z.number().nonnegative() }),
  z.object({ ok: z.literal(false), error: z.string().min(1) }),
]);
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;

export const HealthLiveDataSchema = z.object({
  status: z.literal('live'),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
});
export type HealthLiveData = z.infer<typeof HealthLiveDataSchema>;

export const HealthChecksSchema = z.object({
  database: ReadinessCheckSchema,
});
export type HealthChecks = z.infer<typeof HealthChecksSchema>;

export const HealthReadyDataSchema = z.object({
  status: z.literal('ready'),
  checks: HealthChecksSchema,
});
export type HealthReadyData = z.infer<typeof HealthReadyDataSchema>;

export const HealthLiveResponseSchema = apiResultSchema(HealthLiveDataSchema);
export const HealthReadyResponseSchema = apiResultSchema(HealthReadyDataSchema);
export type HealthLiveResponse = z.infer<typeof HealthLiveResponseSchema>;
export type HealthReadyResponse = z.infer<typeof HealthReadyResponseSchema>;

/** Error code carried by a 503 from /health/ready. */
export const NOT_READY_ERROR_CODE = 'NOT_READY';
