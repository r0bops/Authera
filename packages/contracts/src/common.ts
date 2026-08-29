import { z } from 'zod';

/**
 * Every JSON endpoint returns this envelope (CLAUDE_IMPLEMENTATION_SPEC.md §12).
 */
export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export function apiResultSchema<TData extends z.ZodType>(data: TData) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data, requestId: z.string().min(1) }),
    z.object({ ok: z.literal(false), error: ApiErrorSchema, requestId: z.string().min(1) }),
  ]);
}

export type ApiResult<T> =
  { ok: true; data: T; requestId: string } | { ok: false; error: ApiError; requestId: string };
