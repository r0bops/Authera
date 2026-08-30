# Authera Demo Runbook (trial by fire)

Five minutes, one screen, no developer tools. Everything below works offline with `PAYMENT_MODE=mock` and `OPENAI_MODE=scripted`.

## 0. Start

```bash
cp .env.example .env            # placeholders are fine locally
docker compose up --build       # PostgreSQL 18 + the app on http://localhost:3000
```

Wait for `GET /health/ready` to return 200 (the container health check does this). Open http://localhost:3000 — it redirects to `/dashboard` as Marta (demo session is issued automatically).

If port 5432 is busy: `POSTGRES_PORT=5434 docker compose up --build`.

## 1. Reset the scenario

Open `/demo` → **Reset scenario**. State panel shows `Processor calls: 0`, no captured requests, clock offset 0.

## 2. Create the mandate (as Marta)

In Chat, send: **Buy one economy flight from Caracas to Córdoba next month for at most $150, valid until the end of this month. Ask me before going outside those rules.** The assistant returns a structured plan marked **Ready to review**. Open **Review and authorize**, verify the normalized route, dates, all-in limit, payment Visa •••• 4242, and escalation rule, then select **Authorize mandate**.

Emphasize that the chat message only creates a draft. The signed authorization is created by the separate confirmation dialog, and the deterministic gateway—not the language model—enforces it.

Point at the detail page: status ACTIVE, agent key thumbprint, payment reference (not a card), plain-language limits, signed JWS collapsed under Evidence.

## 3. Inject USD 130 and let the agent buy

Demo control → Inject an offer: price **130.00**, CCS → COR, economy → **Inject**. Then **Run agent** (scripted). Last result shows `ALLOW · ALLOW_WITHIN_MANDATE` and `PURCHASED`. Keep the operational test in `/demo`; use Orders for the purchase record and the Auditor view for gateway events. Chats shows the saved conversation as complete and reopenable. Chat never exposes injection controls.

Show, in order:
- Merchant view (link in the result): identity ✓ → mandate ✓ → checklist all green → cart bound → reservation CONSUMED → payment SUCCEEDED.
- Purchases → receipt: paid 130 vs authorized 150, verification checklist, mandate used.
- Auditor: `chain verified`, the execution's events (`POLICY_EVALUATED`, `USAGE_RESERVED`, `PAYMENT_REQUESTED`, `USAGE_CONSUMED`, `PAYMENT_SUCCEEDED`).

## 4. Inject USD 300 — blocked, zero payment calls

Inject **300.00** → select it in the table → **Direct attempt on selected offer**. Result: `BLOCK · AMOUNT_EXCEEDED`. State panel: `Processor calls` unchanged. (With a `require_human` mandate this pauses instead — see step 8.)

## 5. Let a judge change the combination

Any of: another price, a different route (→ `INTENT_MISMATCH`), business cabin, a date outside the window, or move the demo clock past the expiry (`DEMO_CLOCK_ENABLED=true`) → `MANDATE_EXPIRED`. Every block carries a reason code and an explanation in plain language.

## 6. Adversarial attempts

- **Sign with a forged key** → `SIGNATURE_INVALID` (HTTP 401), audit shows `AGENT_SIGNATURE_REJECTED`.
- **Replay last signed request** → `REPLAY_DETECTED` (HTTP 409), audit shows `REPLAY_REJECTED`.
- **Race two attempts** on a fresh one-use mandate → exactly one `ALLOW`, the other `USAGE_EXHAUSTED` / `RESERVATION_CONFLICT`.

## 7. Revoke live

Mandate detail → **Revoke** → confirm. Demo control → **Direct attempt** again → `MANDATE_REVOKED` immediately; no manual refresh needed (the console polls every second).

## 8. Escalation (optional, 1 minute)

Create a mandate whose chat request says **Ask me before going outside those rules**. Inject **168.00** → Direct attempt → `REQUIRE_HUMAN`. Open the exact approval URL from the Demo result → **Review and decide** → **Approve this purchase only** → Direct attempt with the *same checkout* (Demo control keeps the selected offer; use "Direct attempt" once more) → `ALLOW · ALLOW_CHECKOUT_APPROVAL`, purchased once. A second attempt is not allowed again; a changed cart is `CHECKOUT_HASH_MISMATCH`.

## 9. Dispute (optional)

Receipt → **Report a problem** → "I revoked the mandate before the purchase" → Submit. The resolution page shows the chronological evidence (mandate created → usage reserved → payment succeeded → mandate revoked) and the deterministic outcome (`Purchase was authorized` — revocation is not retroactive).

## 10. Payment edge cases (optional)

Demo control → Environment → Next payments: **pending, then webhook** (delay 3000 ms, duplicate webhook on) → run an attempt → receipt shows PAYMENT PENDING, then SUCCEEDED; auditor shows one `WEBHOOK_RECEIVED` and one `WEBHOOK_DUPLICATE`, usage consumed once. Or **fail** → `PAYMENT_FAILED`, allowance released.

## Fallbacks

- OpenAI unavailable: keep the agent mode `scripted` (default); the OpenAI mode falls back to scripted automatically.
- Venue internet unavailable: everything above runs locally in Docker; no external calls in mock mode.
- Keep a screen recording of steps 2–7 as a last resort.
