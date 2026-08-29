# Purchasing Agent

Phase 7 keeps discovery and purchase selection outside the authorization boundary. Both execution
modes depend on `PurchasingAgentGateway`; neither mode can call a payment provider or construct a
policy verdict.

## Modes

- `scripted`: deterministically selects the cheapest authoritative offer in the task currency that
  is within the human maximum. Ties are broken by departure time and offer ID.
- `openai`: runs one OpenAI Agents SDK agent with exactly `search_flights` and `request_purchase`.
  Both tools use strict Zod schemas, five turns and a 20-second timeout by default, bounded tool
  output, disabled SDK tracing, and locally redacted operational events.

`PurchasingAgentService` selects the configured mode. OpenAI failures fall back to scripted mode
only before the purchase tool reaches the gateway; this prevents an ambiguous network response from
causing a second purchase.

## Signed Demo Attempts

`SignedDemoAttemptService` adapts the API's `AgentHttpClient` through
`AgentHttpClientTransport`. Every attempt uses the same RFC 9421 authenticated routes as an external
agent:

1. `GET /api/flights` with the browse-purpose signature.
2. `POST /ucp/v1/checkout-sessions` with the browse-purpose signature, producing an inert canonical
   cart bound to the server-owned offer.
3. `POST /api/purchase-attempts` with the payment-purpose signature.

The purchase body is constructed locally and contains only `executionId`, `mandateId`, `offerId`,
and `checkoutId`. Price, currency, merchant, payment method, and policy outcome are reloaded by the
Mandate Gateway.

## Safety Properties

- The OpenAI purchase tool accepts only mandate, offer, and checkout UUIDs.
- A purchase must reference an offer/checkout pair returned by the run's authoritative search.
- Search parameters must exactly match the assigned task.
- Checkout preparation fails closed if the offer binding, price, or currency differs.
- Non-2xx signed API responses are errors and are never parsed as success data.
- Fallback is forbidden after a purchase may have been committed.
- Trace redaction recursively removes authorization, signature, secret, token, payment, and card
  fields.

## Verification

```sh
pnpm --filter @agentcerta/purchasing-agent typecheck
pnpm exec vitest run --project unit packages/purchasing-agent/src/purchasing-agent.test.ts
```
