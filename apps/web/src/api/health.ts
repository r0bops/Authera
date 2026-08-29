import {
  HEALTH_ROUTES,
  HealthLiveResponseSchema,
  HealthReadyResponseSchema,
  type HealthLiveResponse,
  type HealthReadyResponse,
} from '@agentcerta/contracts';

/**
 * Health fetchers. Responses are parsed against the shared contracts so the UI
 * only ever renders shapes the API actually promised.
 */
export async function fetchLive(signal?: AbortSignal): Promise<HealthLiveResponse> {
  const response = await fetch(HEALTH_ROUTES.live, {
    signal,
    headers: { accept: 'application/json' },
  });
  return HealthLiveResponseSchema.parse(await response.json());
}

export async function fetchReady(signal?: AbortSignal): Promise<HealthReadyResponse> {
  const response = await fetch(HEALTH_ROUTES.ready, {
    signal,
    headers: { accept: 'application/json' },
  });
  return HealthReadyResponseSchema.parse(await response.json());
}
