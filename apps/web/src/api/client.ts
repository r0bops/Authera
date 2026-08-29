import {
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  IDEMPOTENCY_KEY_HEADER,
  type ApiResult,
} from '@agentcerta/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Reuse a key to retry a state change deliberately; a fresh key is generated otherwise. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Same-origin JSON client. Every mutation carries the CSRF header and an Idempotency-Key; every
 * response is the API envelope, so `ok: false` becomes a typed ApiError with the reason code.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers[CSRF_HEADER] = CSRF_HEADER_VALUE;
    headers[IDEMPOTENCY_KEY_HEADER] = options.idempotencyKey ?? newIdempotencyKey();
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    throw new ApiError(0, 'DISCONNECTED', error instanceof Error ? error.message : 'Network error');
  }
  let envelope: ApiResult<T>;
  try {
    envelope = (await response.json()) as ApiResult<T>;
  } catch {
    throw new ApiError(response.status, 'BAD_RESPONSE', `Unexpected response (${response.status})`);
  }
  if (!envelope.ok) {
    throw new ApiError(
      response.status,
      envelope.error.code,
      envelope.error.message,
      envelope.error.details,
      envelope.requestId,
    );
  }
  return envelope.data;
}
