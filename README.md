# Agentic Pay 2.0 · VuelaYa

Prototipo de compras agénticas seguras que implementa el circuito completo:

**Humano → Mandato firmado → Agente identificado → UCP Checkout → AP2 → Policy Engine → Yuno → Orden → Auditoría**

## Qué implementa

- **RFC 9421 (perfil ES256):** el agente firma cada request HTTP; VuelaYa verifica la firma, el `Content-Digest`, `created/expires` y `keyid`.
- **Web Bot Auth (concepto):** identidad del bot separada de la identidad humana, usando claves públicas publicadas por perfil. Web Bot Auth sigue siendo un conjunto de Internet-Drafts; no se presenta como un RFC definitivo.
- **UCP:** `/.well-known/ucp`, catálogo y checkout REST. VuelaYa calcula el total desde su catálogo, no confía en el monto declarado por el agente.
- **AP2-compatible:** mandatos open, closed Checkout Mandate y Payment Mandate, todos como JWT ES256 firmados por una Trusted Surface de demostración; el Checkout Mandate queda ligado al hash del `checkout_jwt` del merchant.
- **Policy Engine estatal:** estado activo/revocado, vigencia, categoría, moneda, monto, condición de precio, frecuencia, merchant scope y replay protection.
- **Yuno:** adaptador de pagos con modo `mock` por defecto y modo `real` para sandbox. En ninguno de los dos casos el agente recibe PAN/CVV.
- **Audit trail append-only:** cada evento incluye `previous_event_hash` y `event_hash`; existe endpoint para verificar la cadena completa.
- **Disputas:** el resultado usa la evidencia guardada en la compra, no el estado actual del mandato.
- **Trial by fire:** revocar o cambiar límite modifica el estado consultado justo antes del pago; el siguiente intento falla o se ajusta al nuevo límite.

## Estado de la implementación

Esto es una **implementación educativa/interoperable del patrón**, no una certificación oficial de conformidad con AP2, UCP o Web Bot Auth. AP2 también contempla SD-JWT(+kb) y otras credenciales; este prototipo usa JWT ES256 firmados para mantener el circuito legible y ejecutable sin introducir otra dependencia criptográfica.

## Requisitos

- Node.js 20+
- Docker (recomendado) o PostgreSQL 14+

## Arranque

### 1. PostgreSQL

```bash
docker compose up -d postgres
```

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run test
npm run dev
```

Backend: `http://localhost:8787`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:5173`

## Prueba de fuego

1. En **Humano**, observa el mandato inicial: categoría `flights`, límite USD 150 y método Yuno tokenizado.
2. En **Agente**, ejecuta el vuelo de USD 130. El flujo real del demo es:
   `agent signs HTTP → UCP checkout → merchant-signed checkout JWT → AP2 closed mandate → policy → payment mandate → Yuno mock`.
3. Ejecuta USD 300: el checkout existe, pero el policy engine rechaza antes de Yuno.
4. Ejecuta el hotel: rechazo por categoría.
5. Revoca el mandato en **Humano**.
6. Repite USD 130: la consulta de estado posterior al checkout ve `revoked` y no llama a Yuno.
7. En **Auditor**, pulsa “Verificar hash chain”.
8. Cambia el límite a USD 100 y repite USD 130: debe rechazar por `amount_allowed=false`.

## Yuno real

Yuno requiere credenciales de una cuenta de sandbox y un flujo de tokenización/checkout de su SDK. El adapter `backend/src/yuno.js` ya construye el `POST /v1/payments` del sandbox, usa `X-Idempotency-Key`, soporta `vaulted_token` y envía metadatos con el `mandate_id`, `checkout_hash` y `agent_id`.

Configura:

```env
YUNO_MODE=real
YUNO_ACCOUNT_ID=...
YUNO_PRIVATE_SECRET_KEY=...
YUNO_PUBLIC_API_KEY=...
```

Para un entorno real, sustituye el `DEMO_YUNO_VAULTED_TOKEN` por el token generado/enrolado mediante el SDK de Yuno. **No pongas PAN/CVV en este backend, en el agente ni en prompts del LLM.**

## Endpoints principales

| Método | Ruta | Propósito |
|---|---|---|
| GET | `/.well-known/ucp` | Perfil UCP de VuelaYa |
| GET | `/ucp/shopping/catalog` | Catálogo demo |
| POST | `/ucp/shopping/checkout-sessions` | Checkout UCP, con firma del agente |
| POST | `/api/agent/purchase` | Orquestación completa de compra |
| POST | `/api/mandates` | Crear mandato firmado |
| POST | `/api/mandates/:id/revoke` | Revocación en vivo |
| POST | `/api/mandates/:id/limit` | Cambiar límite + versionado |
| POST | `/api/verify` | Verificación previa del merchant |
| GET | `/api/audit/verify-chain` | Verificar integridad del trail |
| POST | `/api/purchases/:id/dispute` | Disputa basada en evidencia |

## Estructura

```text
agentic-pay/
  backend/
    src/
      ap2.js
      crypto.js
      db.js
      decision-engine.js   # legado, se conserva para referencia
      index.js
      policy.js
      schema.sql
      yuno.js
    test/security.test.js
    .env.example
  frontend/
    src/App.jsx
    src/api.js
  docker-compose.yml
```

## Fuentes de diseño

- RFC 9421: HTTP Message Signatures.
- AP2 v0.2: Checkout Mandates, Payment Mandates, receipts y verificación determinista.
- UCP: perfil `/.well-known/ucp`, discovery, checkout y request signatures.
- Yuno: tokenización, one-time tokens/vaulted tokens y Create Payment.
