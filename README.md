# AgentCerta

**The mandate gateway for agentic commerce.**

AgentCerta is a merchant-side authorization gateway for purchases initiated by AI agents. A human issues a signed, bounded **mandate** ("buy one economy flight Caracas → Córdoba on VuelaYa for at most USD 150 before month end"); the agent discovers offers and *requests* a purchase; a deterministic gateway verifies agent identity, mandate validity, and the exact checkout, reserves usage atomically in PostgreSQL, and only then calls the payment processor. Every decision leaves an auditable trail that the human, the merchant, and an auditor can read.

Built for **NextWave Hackathon 2026 — Challenge 1: Agentic Purchase Mandates** (Yuno × Nauta, supported by OpenAI).

> **Status:** Phase 0 (foundation) complete. See [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) for the phase ledger and verification evidence, and [`docs/architecture.md`](./docs/architecture.md) for the architecture.

## Non-negotiables (from the spec)

- The deterministic **Mandate Gateway** is the only component that returns `ALLOW`, `BLOCK`, or `REQUIRE_HUMAN`.
- The LLM may discover offers and request purchases; it never authorizes and never calls the payment processor.
- The agent submits **identifiers only**; the server loads price, currency, merchant, offer, checkout, mandate, and payment reference.
- Agent identity and human authorization are **separate** checks.
- Revocation and usage reservation update the **same** `mandate_runtime` row.
- No external network call inside a database transaction; `BLOCK` / `REQUIRE_HUMAN` never touch the processor.
- Everything is idempotent; unknown mandate conditions **fail closed**.
- The full demo works offline with `PAYMENT_MODE=mock` and `OPENAI_MODE=scripted`.

Full source of truth: [`CLAUDE_IMPLEMENTATION_SPEC.md`](./CLAUDE_IMPLEMENTATION_SPEC.md).

## Stack

Node.js 24 LTS · TypeScript (ESM) · pnpm workspaces · React 19 + Vite 8 · Hono on `@hono/node-server` · Zod 4 · PostgreSQL 18 · Drizzle ORM + `pg` · Pino · Vitest · Testcontainers · Docker Compose.

## Repository layout

```text
apps/
  api/        Hono HTTP application (health, later: gateway, human/merchant/auditor APIs, webhooks)
  web/        React 19 + Vite desktop console (served by the API in production)
packages/
  contracts/  Shared external shapes and Zod schemas (API envelope, health, later: mandate/policy/...)
  domain/     Pure deterministic logic — no HTTP, UI, LLM, payment, or DB imports (lint-enforced)
  db/         PostgreSQL client, Drizzle schema + migrations, repositories, atomic transitions
  test-support/ Test helpers (env builders, later: clocks, factories, fakes)
tests/
  integration/  Real PostgreSQL via Testcontainers
  contract/     API contract tests (later phases)
  e2e/          Playwright trial-by-fire suite (later phases)
docs/           architecture.md (+ threat-model.md, demo-runbook.md in later phases)
```

## Prerequisites

- Node.js 24 LTS
- pnpm 11 (`npm i -g pnpm@11.22.0`)
- Docker with Compose v2 (for PostgreSQL, the integration tests, and the production image)

## Quick start (development)

```bash
pnpm install
cp .env.example .env            # placeholders are fine locally
docker compose up -d postgres   # PostgreSQL 18 on localhost:5432
pnpm dev                        # API on http://localhost:3000, Vite on http://localhost:5173
```

The Vite dev server proxies `/health`, `/api`, `/ucp`, `/.well-known`, and `/webhooks` to the API so the browser sees a single origin, exactly as in production.

## Quick start (production image)

```bash
docker compose up --build       # builds the image, starts PostgreSQL + the app on http://localhost:3000
curl -s localhost:3000/health/live
curl -s localhost:3000/health/ready
```

The image is a multi-stage build: Vite compiles `apps/web`, tsup bundles `apps/api` (workspace packages inlined, third-party runtime deps installed), and the runtime stage serves the SPA from Hono with an `index.html` fallback for client routes. Backend namespaces always answer JSON.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Run API (`tsx watch`) and web (Vite) together |
| `pnpm build` | Build web (`vite build`) and API (`tsup` → `apps/api/dist/server.js`) |
| `pnpm start` | Run the built API (serves `apps/web/dist` when present) |
| `pnpm typecheck` | `tsc --noEmit` for the root tests and every workspace package |
| `pnpm lint` / `pnpm format` / `pnpm format:check` | ESLint (flat config) / Prettier |
| `pnpm test` | All Vitest projects (unit + integration; integration needs Docker) |
| `pnpm test:unit` | Unit tests under `apps/**/src` and `packages/**/src` |
| `pnpm test:integration` | Testcontainers PostgreSQL tests under `tests/integration` |
| `pnpm test:e2e` | Playwright suite — placeholder until Phase 8 (exits non-zero on purpose) |
| `pnpm db:generate` | `drizzle-kit generate` (schema arrives in Phase 2) |
| `pnpm db:migrate` | Apply migrations (no-op with a clear message until the first migration exists) |
| `pnpm db:seed` / `pnpm demo:reset` | Placeholders until Phase 2 (exit non-zero on purpose) |
| `pnpm verify` | `format:check` → `lint` → `typecheck` → `test:unit` → `build` |

## Environment

Copy `.env.example` to `.env`. Variables are validated at startup (`apps/api/src/config.ts`); a bad configuration fails fast listing variable names, never values.

| Variable | Notes |
|---|---|
| `NODE_ENV`, `PORT`, `PUBLIC_BASE_URL`, `LOG_LEVEL` | Defaults: `development`, `3000`, `http://localhost:3000`, `info` |
| `DATABASE_URL` | Required, `postgres://` or `postgresql://` |
| `SESSION_SECRET` | Required, ≥ 32 chars; production refuses the `.env.example` placeholder |
| `DEMO_MODE`, `DEMO_RESET_SECRET`, `DEMO_CLOCK_ENABLED` | Demo mode defaults to on outside production; the reset secret is required while it is on |
| `PAYMENT_MODE` | `mock` (default) or `yuno` — Yuno keys required only for `yuno` |
| `OPENAI_MODE`, `OPENAI_API_KEY`, `OPENAI_MODEL` | `scripted` (default) or `openai` — key required only for `openai` |
| `YUNO_*`, `*_PRIVATE_JWK`, `WEBAUTHN_*` | Integration secrets for later phases; keep out of the repository |
| `WEB_DIST_DIR` | Optional absolute path of the compiled SPA (defaults to `apps/web/dist`) |

## Health endpoints

| Endpoint | Meaning |
|---|---|
| `GET /health/live` | The process is running. `200 { ok: true, data: { status: "live", uptimeSeconds, timestamp }, requestId }` |
| `GET /health/ready` | PostgreSQL answered `SELECT 1`. `200` with `checks.database.latencyMs`, or `503 { ok: false, error: { code: "NOT_READY", details: { checks } } }`. Readiness never depends on OpenAI or Yuno. |

Every JSON response uses the envelope `{ ok: true, data, requestId } | { ok: false, error: { code, message, details? }, requestId }`; `X-Request-Id` is honoured and echoed.

## Documents

- `HACKATHON.md` — event facts and deadlines
- `CHALLENGES.md` — the four official briefs (we build Challenge 1)
- `RESEARCH.md` — organizer research and judging signals
- `TECH_STACK_RESEARCH.md` — stack rationale
- `END_USER_UX_IMAGE_PROMPTS.md` — desktop UX direction
- `CLAUDE_IMPLEMENTATION_SPEC.md` — implementation source of truth
- `IMPLEMENTATION_STATUS.md` — phase ledger, decisions, test evidence, blockers
