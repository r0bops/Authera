# Authera

**The mandate gateway for agentic commerce.**

Every payment system assumes the one pressing "pay" is a person. Authera is what a merchant puts in front of its checkout when the buyer is an AI agent: a human signs a bounded **mandate**, the agent shops with a cryptographic identity and submits *identifiers only*, and a deterministic gateway decides — `ALLOW`, `BLOCK`, or `REQUIRE_HUMAN` — reserves the allowance atomically in PostgreSQL, and only then pays. Every party gets a readable record; disputes are settled from evidence, not from anyone's word.

Built for **NextWave Hackathon 2026 — Challenge 1: Agentic Purchase Mandates** (Yuno × Nauta, supported by OpenAI).

- Demo runbook: [`docs/demo-runbook.md`](./docs/demo-runbook.md)
- Architecture: [`docs/architecture.md`](./docs/architecture.md)
- Threat model: [`docs/threat-model.md`](./docs/threat-model.md)

## The scenario

Marta authorizes her agent, *Aria*, to buy **one economy flight Caracas → Córdoba for at most USD 150** before the end of the month, using a tokenized card, from any of the merchants she ticks (VuelaYa in Venezuela, AeroSur in Argentina, AndesGo Travel in Colombia). Aria searches all three markets, compares every authoritative offer, and explains its pick in one sentence. When a USD 130 offer appears in any market, Aria requests the purchase; Authera verifies Aria's signature, Marta's signed mandate, and the exact checkout, reserves the single allowed use, pays, and hands everyone a receipt. A USD 300 offer is blocked (or paused for Marta), a forged key is rejected, a replayed request is rejected, two racing attempts yield one purchase, and a live revocation stops the next attempt cold.

## What the gateway guarantees

| Guarantee | How |
|---|---|
| The LLM never authorizes anything | The purchasing agent has two tools (`search_flights`, `request_purchase`) and submits ids only; `evaluatePolicy` is a pure function and PostgreSQL holds live state |
| Live market, same guarantees | With `DUFFEL_ACCESS_TOKEN` set, discovery also queries the Duffel Flights API (test mode) as a fourth merchant; its offers are stored server-side first, the winner is re-priced with Duffel right before the checkout binds its cart, and a changed or vanished price fails closed (`OFFER_NOT_AVAILABLE`) |
| The agent chooses, the gateway decides | `search_flights` fans out over every merchant/market (each offer carries `merchantName` + `market`); the agent ranks them and records a plain-language `selectionReason`; the gateway re-checks the chosen merchant against the mandate's `allowedMerchantIds` and blocks with `MERCHANT_NOT_ALLOWED` |
| Agent identity ≠ human authority | RFC 9421 (Ed25519) signed requests prove *who*; the trusted-surface JWS mandate proves *what was allowed*; both are checked separately |
| No spend outside the mandate | Route, cabin, passengers, dates, merchant, currency, per-purchase and total caps, usage count, validity window — evaluated on server data, then enforced again by one conditional `UPDATE` on `mandate_runtime` |
| Live revocation | Revocation and reservation update the same row; whichever commits first wins, and every attempt after revocation fails |
| Replay and impersonation fail | Unique `(agent key, nonce)`, short signature lifetime, body digest, pinned key directory |
| The cart cannot change under an approval | Canonical (RFC 8785) cart hash bound to checkouts and to single-use human approvals |
| Money moves once | Execution id = provider idempotency key; provider calls happen outside transactions; settlement consumes or releases exactly once; duplicate webhooks are harmless |
| Evidence you can audit | Append-only, hash-chained events; per-execution evidence bundles with a bundle hash; deterministic dispute resolution |
| Real processor, same relay | `PAYMENT_MODE=stripe` charges a Stripe **test-mode** PaymentIntent (`confirm=true`, `off_session=true`) with the execution id as Stripe's idempotency key; declines map to `PAYMENT_FAILED`, `processing` to `PAYMENT_PENDING`, and `/webhooks/stripe` verifies `Stripe-Signature` before any state moves. Live keys are refused at startup |
| Works offline | `PAYMENT_MODE=mock`, `OPENAI_MODE=scripted` run the whole challenge without external services |

## Quick start

```bash
pnpm install
cp .env.example .env
docker compose up --build            # PostgreSQL 18 + app → http://localhost:3000
```

Development with hot reload:

```bash
docker compose up -d postgres        # POSTGRES_PORT=5434 if 5432 is taken
pnpm dev                             # API on :3000, Vite on :5173 (proxies to the API)
```

The API runs migrations and seeds the demo scenario (Marta, VuelaYa, Aria, Visa •••• 4242, a flight catalog with nothing under USD 150) on start when `DEMO_MODE=true`.

## Console

One desktop console, four roles, one event stream:

- **Marta** — overview, guided mandate wizard, mandate detail with revoke/revise, purchases and receipts, approvals, disputes.
- **Agent** — price watch, offers considered, signed requests, gateway decisions.
- **Merchant** — identity → mandate → constraint checklist → checkout binding → reservation/payment for any execution.
- **Auditor** — filterable hash-chained ledger with live chain verification and evidence export.
- **Demo control** — inject offers, run the agent (scripted/OpenAI), direct/forged/replayed/concurrent attempts, demo clock, mock payment behavior, simulated webhooks.

## API surface

| Lane | Endpoints |
|---|---|
| Health | `GET /health/live`, `GET /health/ready` |
| Discovery | `GET /.well-known/ucp`, `GET /.well-known/http-message-signatures-directory`, `GET /agents/:id/profile` |
| Signed agent (browse) | `GET /api/flights` (cross-merchant, cross-market catalog), `POST /ucp/v1/checkout-sessions`, `GET /ucp/v1/checkout-sessions/:id` |
| Signed agent (payment) | `POST /api/purchase-attempts` — body is `{ executionId, mandateId, offerId, checkoutId }` and nothing else |
| Human (cookie + CSRF + Idempotency-Key) | `/api/me`, `/api/mandates[...]`, `/api/approvals[...]`, `/api/purchases[...]`, `/api/disputes[...]`, `/api/executions`, `/api/verification/:id`, `/api/evidence/:id[/export]`, `/api/audit/events`, `/api/audit/verify` |
| Demo (DEMO_MODE) | `/api/demo/*` |
| Webhooks | `POST /webhooks/stripe`, `POST /webhooks/yuno` (raw-body signature checks), `POST /webhooks/mock/:executionId` (demo) |

All JSON responses use `{ ok: true, data, requestId } | { ok: false, error: { code, message, details? }, requestId }`.

## Repository layout

```text
apps/api          Hono API (Node 24): gateway, signing, sessions, payments, demo controls, serves the SPA
apps/web          React 19 + Vite console
packages/contracts  Zod schemas shared by API, agent, and console
packages/domain     Pure logic: policy evaluator, state machines, money, canonical hashing, RFC 9421, dispute resolver
packages/db         PostgreSQL (Drizzle + pg): schema, migrations, atomic transactions, audit chain, seed
packages/purchasing-agent  Scripted + OpenAI purchasing agent with strict tools
packages/test-support      Fixtures and signed-request helpers
tests/integration   Testcontainers PostgreSQL suites (concurrency, revocation, replay, settlement)
docs/               architecture, threat model, demo runbook
```

## Scripts

`pnpm dev` · `pnpm build` · `pnpm start` · `pnpm typecheck` · `pnpm lint` · `pnpm test` (unit + integration; integration needs Docker) · `pnpm test:unit` · `pnpm test:integration` · `pnpm test:e2e` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm demo:reset` · `pnpm verify` (format → lint → typecheck → unit → build).

## Configuration

See [`.env.example`](./.env.example). Highlights: `PAYMENT_MODE=mock|stripe|yuno` (`STRIPE_SECRET_KEY=sk_test_…` required for `stripe`, Yuno keys only for `yuno`), `DUFFEL_ACCESS_TOKEN` (optional; enables the live Duffel flight market, fails open when absent or unreachable), `OPENAI_MODE=scripted|openai` (`OPENAI_API_KEY` required only for `openai`), `DEMO_MODE` (on locally, off in production), `DEMO_RESET_SECRET` (also derives demo signing keys when explicit `*_PRIVATE_JWK` values are absent), `DEMO_CLOCK_ENABLED`. Startup validation fails fast and never echoes secret values.

## Deployment

One Docker service plus PostgreSQL. `railway.json` builds from the `Dockerfile` and gates deploys on `GET /health/ready` (database reachable, schema migrated). Set `NODE_ENV=production`, a real `SESSION_SECRET`, `DATABASE_URL`, `PUBLIC_BASE_URL`, and explicit signing keys for anything beyond a demo.

## Limitations (honest)

- Yuno adapter unverified against a live sandbox; the demo runs on the mock processor.
- Passkey action-hash verification is implemented and tested, but credential registration and UI wiring remain P1; human demo actions use the seeded session.
- Rate limiting not implemented.
- The audit ledger is tamper-evident, not immutable (no external anchoring).
- Local Playwright acceptance passed twice across both supported desktop viewports; Railway deployment still requires a linked project.
