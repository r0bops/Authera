# AgentCerta Architecture

Status: **Phase 0** — deployable foundation. Diagrams show the target system from
`CLAUDE_IMPLEMENTATION_SPEC.md` §7 and mark what exists today.

## System overview (target)

```mermaid
flowchart LR
  H[Human browser] -->|session + idempotency key| API[Hono application]
  A[Purchasing agent] -->|Web Bot Auth signed request| API
  API --> ID[Agent identity verifier]
  API --> MG[Mandate Gateway]
  MG --> PE[Pure policy engine]
  MG --> DB[(PostgreSQL)]
  MG --> PP[PaymentProcessor]
  PP --> MP[Mock processor]
  PP --> Y[Yuno sandbox]
  API --> OA[OpenAI agent runner]
  OA -->|search_flights| API
  OA -->|request_purchase| MG
  Y -->|HMAC webhook| API
  API --> AUD[Evidence builder]
  API --> WEB[React desktop console]
```

Authority lives in exactly one place: the deterministic **Mandate Gateway** (pure policy
engine + atomic PostgreSQL state). The LLM discovers and requests; it never authorizes.

## What Phase 0 delivers

```mermaid
flowchart LR
  subgraph Browser
    SPA[React 19 + Vite console]
  end
  subgraph "Node.js 24 process (apps/api)"
    RID[request-id + logger middleware]
    HL["GET /health/live"]
    HR["GET /health/ready"]
    ST[Static SPA + index.html fallback]
    ENV[Zod-validated config]
  end
  PG[(PostgreSQL 18)]

  SPA -->|same origin| RID
  RID --> HL
  RID --> HR
  RID --> ST
  HR -->|SELECT 1 with timeout| PG
  ENV -.-> RID
```

| Concern | Where | Notes |
|---|---|---|
| Environment contract | `apps/api/src/config.ts` | Mode-conditional secrets; fails fast without echoing values |
| HTTP envelope | `packages/contracts/src/common.ts`, `apps/api/src/http/envelope.ts` | `{ ok, data | error, requestId }` everywhere |
| Liveness / readiness | `apps/api/src/routes/health.ts` | Readiness = real DB round-trip; 503 with the failing check; never depends on OpenAI/Yuno |
| DB client | `packages/db/src/client.ts` | `pg` pool with connection timeout; credential-free error descriptions |
| Static serving | `apps/api/src/http/static.ts` | Backend namespaces (`/api`, `/health`, `/ucp`, `/.well-known`, `/webhooks`) never fall back to the SPA |
| Logging | `apps/api/src/logger.ts` | Pino JSON with redaction paths for auth headers, cookies, keys, tokens, secrets |
| Deployment | `Dockerfile`, `docker-compose.yml` | One app container + PostgreSQL; app waits for `service_healthy` |

## Package boundaries

```mermaid
flowchart TB
  web[apps/web] --> contracts[packages/contracts]
  api[apps/api] --> contracts
  api --> domain[packages/domain]
  api --> db[packages/db]
  db --> contracts
  domain --> contracts
  ts[packages/test-support] -.dev only.-> api
```

- `packages/domain` is pure: no Hono, React, OpenAI, Yuno, `pg`, or Drizzle imports (ESLint `no-restricted-imports` enforces it).
- `apps/web` never imports `packages/db` or server secrets.
- Workspace packages export TypeScript source; `tsup` inlines them into `apps/api/dist/server.js`, while third-party runtime dependencies stay external and are installed in the image.

## Purchase sequence (target, Phase 5+)

```mermaid
sequenceDiagram
  participant Agent
  participant API as AgentCerta API
  participant DB as PostgreSQL
  participant Pay as PaymentProcessor

  Agent->>API: Signed purchase attempt (executionId, mandateId, offerId, checkoutId)
  API->>API: Verify signature, time, key, digest
  API->>DB: Insert unique nonce
  API->>DB: Load mandate, offer, checkout, agent
  API->>API: Evaluate deterministic policy
  API->>DB: Atomic reservation on mandate_runtime
  alt reservation succeeds
    API->>Pay: purchase(execution_id, token_ref, amount)
    Pay-->>API: pending/succeeded/failed
    API->>DB: Idempotent consume or release
    API-->>Agent: execution and evidence IDs
  else reservation fails
    API->>DB: Append blocked audit event
    API-->>Agent: blocked reason code
  end
```

## Build and runtime topology

1. `vite build` compiles `apps/web` to static assets.
2. `tsup` bundles `apps/api/src/server.ts` (+ workspace packages) to ESM.
3. The Docker runtime stage copies both plus the API's production `node_modules`.
4. Hono serves `/health` (and later `/api`, `/ucp`, `/.well-known`, `/webhooks`) and the SPA fallback from one process on one port.
5. Railway (or any Docker host) runs that image next to a PostgreSQL service; `/health/ready` gates deployment.
