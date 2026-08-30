# Authera

**The mandate gateway for agentic commerce.**

Every payment system assumes the one pressing "pay" is a person. Authera is what a merchant puts in front of its checkout when the buyer is an AI agent: a human signs a bounded **mandate**, the agent shops with a cryptographic identity and submits *identifiers only*, and a deterministic gateway decides — `ALLOW`, `BLOCK`, or `REQUIRE_HUMAN` — reserves the allowance atomically in PostgreSQL, and only then pays. Every party gets a readable record; disputes are settled from evidence, not from anyone's word.

Built for **NextWave Hackathon 2026 — Challenge 1: Agentic Purchase Mandates** (Yuno × Nauta, supported by OpenAI).

- Demo runbook: [`docs/demo-runbook.md`](./docs/demo-runbook.md)
- Architecture: [`docs/architecture.md`](./docs/architecture.md)
- Threat model: [`docs/threat-model.md`](./docs/threat-model.md)

## The scenario

Marta authorizes her agent, *Aria*, to buy **one economy flight Caracas → Córdoba for at most USD 150** before the end of the month, using a tokenized card. Aria searches the live market (real offers via the Duffel Flights API, test mode — nothing on the dashboard is invented), compares every authoritative offer, and explains its pick in one sentence. When a qualifying Duffel offer appears, Aria requests the purchase; Authera verifies Aria's signature, Marta's signed mandate, and the exact checkout, reserves the single allowed use, authorizes Stripe, creates the Duffel sandbox order, and captures Stripe only after Duffel confirms the booking. Judge-injected offers are clearly labelled and exercise the policy/payment path without pretending to be bookable flights. A USD 300 offer is blocked (or paused for Marta), a forged key is rejected, a replayed request is rejected, two racing attempts yield one purchase, and a live revocation stops the next attempt cold.

## What the gateway guarantees

| Guarantee | How |
|---|---|
| The LLM never authorizes anything | The chat interpreter may draft structured rules and the purchasing agent may search/request, but neither can activate a mandate or produce `ALLOW`; `evaluatePolicy` is a pure function and PostgreSQL holds live state |
| The agent really watches | A background price watcher re-runs discovery for every active mandate every `PRICE_WATCH_INTERVAL_MS` (new mandates within ~30 s), so the catalog and the price chart follow the live market. Discovery only: no checkout, no gateway call — buying stays an explicit agent run |
| More than flights | A mandate's `intent` is a discriminated union: `flight` (route, cabin, dates, passengers) or `goods` (“what to buy”, max quantity). Goods are discovered on a real public Shopify storefront (`SHOPIFY_STOREFRONT_URL`, Allbirds in the demo) and the gateway checks `INTENT_KIND`, `INTENT_QUERY` (the offer must have been found under the mandate's exact query) and `INTENT_QUANTITY` before the money limits. Transport is a roadmap intent: no keyless, real, bookable source exists yet |
| Live market, same guarantees | With a `duffel_test_…` token, discovery queries Duffel, stores offers server-side, and re-prices the winner before checkout. After Stripe authorization, Authera creates an instant Duffel test-balance order using a server-side traveler profile; only a confirmed `ord_…` result permits capture. Changed offers fail closed and ambiguous order responses stay pending for reconciliation |
| Closed Checkout Mandate | Every purchase attempt carries an agent-signed JWS (`authera.closed-checkout.v1`, EdDSA, same key as the HTTP signature) over exactly the transaction — mandate, offer, checkout, canonical cart hash, total, 5-minute expiry. The gateway verifies it against the pinned key and the server's own records before policy; missing, tampered or mismatched → `CLOSED_CHECKOUT_INVALID`. It is stored with the verdict, shown in the evidence bundle, and emitted as `agent_closed_checkout_jws` in the AP2-aligned envelope |
| The agent chooses, the gateway decides | `search_flights` fans out over every merchant/market (each offer carries `merchantName` + `market`); the agent ranks them and records a plain-language `selectionReason`; the gateway re-checks the chosen merchant against the mandate's `allowedMerchantIds` and blocks with `MERCHANT_NOT_ALLOWED` |
| Agent identity ≠ human authority | RFC 9421 (Ed25519) signed requests prove *who*; the trusted-surface JWS mandate proves *what was allowed*; both are checked separately |
| No spend outside the mandate | Route, cabin, passengers, dates, merchant, currency, per-purchase and total caps, usage count, validity window — evaluated on server data, then enforced again by one conditional `UPDATE` on `mandate_runtime` |
| Live revocation | Revocation and reservation update the same row; whichever commits first wins, and every attempt after revocation fails |
| Replay and impersonation fail | Unique `(agent key, nonce)`, short signature lifetime, body digest, pinned key directory |
| The cart cannot change under an approval | Canonical (RFC 8785) cart hash bound to checkouts and to single-use human approvals |
| Money moves once | Execution id = provider idempotency key; provider calls happen outside transactions; settlement consumes or releases exactly once; duplicate webhooks are harmless |
| Evidence you can audit | Append-only, hash-chained events; per-execution evidence bundles with a bundle hash; deterministic dispute resolution |
| Real processor, same relay | `PAYMENT_MODE=stripe` confirms a Stripe **test-mode** PaymentIntent with manual capture and the execution id as its idempotency key. A confirmed fulfillment triggers capture; a definite booking rejection triggers cancellation; unclear outcomes stay `PAYMENT_PENDING`. `/webhooks/stripe` verifies `Stripe-Signature`, and live keys are refused at startup |
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

The API runs migrations and seeds only the people and connections (Marta, Aria, Visa •••• 4242, the live merchants Duffel Marketplace and Allbirds); the catalog is never seeded — offers come from live searches or labelled judge injections. Seeding runs on start when `DEMO_MODE=true`.

## Local interfaces

One deployment exposes separate route trees for each perspective while sharing the same event stream:

- **Marta — `/dashboard`**: a clean, flight-focused conversation with a persistent bottom dock for Chats, New, and Account. Aria opens naturally and asks one question at a time; buttons appear only for consequential confirmation or change actions, and there is no mandate form inside chat. Conversations persist across reloads and navigation. Signed confirmation, revocation, approvals, receipts, and disputes remain trusted surfaces outside free-form chat.
- **Agent — `/agent`**: price watch, offers considered, signed requests, gateway decisions.
- **Merchant — `/verify`**: identity → mandate → constraint checklist → checkout binding → reservation/payment for any execution.
- **Auditor — `/audit`**: filterable hash-chained ledger with live chain verification and evidence export.
- **Demo control — `/demo`**: inject offers, run the agent (scripted/OpenAI), direct/forged/replayed/concurrent attempts, demo clock, mock payment behavior, simulated webhooks.

The route separation is a local product boundary, not a replacement for role-specific production authentication.

## API surface

| Lane | Endpoints |
|---|---|
| Health | `GET /health/live`, `GET /health/ready` |
| Discovery | `GET /.well-known/ucp`, `GET /.well-known/http-message-signatures-directory`, `GET /agents/:id/profile` |
| Signed agent (browse) | `GET /api/flights` (cross-merchant, cross-market catalog), `GET /api/products?q=` (live storefront search), `POST /ucp/v1/checkout-sessions`, `GET /ucp/v1/checkout-sessions/:id` |
| Signed agent (payment) | `POST /api/purchase-attempts` — body is `{ executionId, mandateId, offerId, checkoutId }` and nothing else |
| Human (cookie + CSRF + Idempotency-Key) | `/api/me`, `/api/chats[...]` (durable conversations), `POST /api/chat/interpret` (draft only), `/api/mandates[...]`, `/api/approvals[...]`, `/api/purchases[...]` (including printable payment receipt and Duffel booking confirmation), `/api/disputes[...]`, `/api/executions`, `/api/verification/:id`, `/api/evidence/:id[/export]`, `/api/audit/events`, `/api/audit/verify` |
| Demo (DEMO_MODE) | `/api/demo/*` |
| Webhooks | `POST /webhooks/stripe` (raw-body `Stripe-Signature` check), `POST /webhooks/mock/:executionId` (demo) |

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

See [`.env.example`](./.env.example). Highlights: `PAYMENT_MODE=mock|stripe` (`STRIPE_SECRET_KEY=sk_test_…` required for `stripe`), `DUFFEL_ACCESS_TOKEN` (optional; enables the live Duffel flight market, fails open when absent or unreachable), `SHOPIFY_STOREFRONT_URL` (optional; a public Shopify storefront as the live goods market), `OPENAI_MODE=scripted|openai` (`OPENAI_API_KEY` required only for `openai`), `DEMO_MODE` (on locally, off in production), `DEMO_RESET_SECRET` (also derives demo signing keys when explicit `*_PRIVATE_JWK` values are absent), `DEMO_CLOCK_ENABLED`. Startup validation fails fast and never echoes secret values.

For local Stripe webhook forwarding, run this as one line and copy the CLI's `whsec_…` value into `STRIPE_WEBHOOK_SECRET`:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe --events payment_intent.amount_capturable_updated,payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,payment_intent.processing
```

## Deployment

One Docker service plus PostgreSQL. `railway.json` builds from the `Dockerfile` and gates deploys on `GET /health/ready` (database reachable, schema migrated). Set `NODE_ENV=production`, a real `SESSION_SECRET`, `DATABASE_URL`, `PUBLIC_BASE_URL`, and explicit signing keys for anything beyond a demo.

## Limitations (honest)

- Payments and flight orders run only in Stripe/Duffel **test mode** (or the mock); both adapters reject live credentials for fulfillment. No production PSP or ticketing deployment is wired.
- An ambiguous Duffel order response is intentionally not retried automatically: the booking, authorization, and reservation remain pending until a reconciliation worker or operator resolves the provider state.
- Authera can issue a payment receipt and a Duffel booking confirmation. It cannot issue an airline boarding pass; that becomes available from the airline only after check-in. The sandbox confirmation is labelled as test mode and is not a tax invoice.
- Passkey action-hash verification is implemented and tested, but credential registration and UI wiring remain P1; human demo actions use the seeded session.
- Rate limiting not implemented.
- The audit ledger is tamper-evident, not immutable (no external anchoring).
- Local Playwright acceptance passed twice across both supported desktop viewports; Railway deployment still requires a linked project.

## Standards and references

- **AP2 — Agent Payments Protocol** (Google agentic commerce): https://github.com/google-agentic-commerce/AP2 — the mandate model (intent → cart → payment mandates) Authera's purchase mandates and audit trail are aligned with.
- **RFC 9421 — HTTP Message Signatures**: https://www.rfc-editor.org/rfc/rfc9421 — how every agent request to the gateway is signed and verified.
