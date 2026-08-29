import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * PostgreSQL model (CLAUDE_IMPLEMENTATION_SPEC.md §10). Money is bigint minor units with an
 * explicit currency column; counters carry non-negative checks; every uniqueness rule the
 * gateway relies on (nonce, idempotency, one runtime per version, one reservation and one
 * payment per execution, webhook identity) is a database constraint, not application memory.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  ...timestamps,
});

export const humanSessions = pgTable(
  'human_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('human_sessions_user_idx').on(t.userId)],
);

export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  transports: jsonb('transports').$type<string[]>(),
  ...timestamps,
});

export const merchants = pgTable('merchants', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  /** Market the merchant sells from (ISO 3166-1 alpha-2), used for cross-market discovery. */
  market: text('market').notNull().default('VE'),
  status: text('status').notNull().default('ACTIVE'),
  ...timestamps,
});

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey(),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id),
  displayName: text('display_name').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  profileUri: text('profile_uri').notNull(),
  ...timestamps,
});

export const agentKeys = pgTable('agent_keys', {
  id: uuid('id').primaryKey(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id),
  thumbprint: text('thumbprint').notNull().unique(),
  publicJwk: jsonb('public_jwk').$type<Record<string, string>>().notNull(),
  status: text('status').notNull().default('ACTIVE'),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  ...timestamps,
});

/** Public keys for the trusted surface (signs mandates) and the merchant (signs receipts). */
export const signingKeys = pgTable('signing_keys', {
  id: uuid('id').primaryKey(),
  role: text('role').notNull(),
  kid: text('kid').notNull().unique(),
  publicJwk: jsonb('public_jwk').$type<Record<string, string>>().notNull(),
  status: text('status').notNull().default('ACTIVE'),
  ...timestamps,
});

export const paymentMethods = pgTable('payment_methods', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  provider: text('provider').notNull(),
  tokenRef: text('token_ref').notNull(),
  displayBrand: text('display_brand').notNull(),
  displayLast4: text('display_last4').notNull(),
  ...timestamps,
});

export const mandates = pgTable('mandates', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id),
  currentVersion: integer('current_version').notNull().default(1),
  ...timestamps,
});

export const mandateVersions = pgTable(
  'mandate_versions',
  {
    id: uuid('id').primaryKey(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id),
    version: integer('version').notNull(),
    policy: jsonb('policy').$type<Record<string, unknown>>().notNull(),
    policyHash: text('policy_hash').notNull(),
    jws: text('jws').notNull(),
    signingKid: text('signing_kid').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('mandate_versions_mandate_version_uq').on(t.mandateId, t.version)],
);

/** The hot row: revocation and usage reservation contend here (spec §10). */
export const mandateRuntime = pgTable(
  'mandate_runtime',
  {
    id: uuid('id').primaryKey(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id),
    version: integer('version').notNull(),
    status: text('status').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    currency: text('currency').notNull(),
    maxPerPurchaseMinor: bigint('max_per_purchase_minor', { mode: 'number' }).notNull(),
    maxTotalMinor: bigint('max_total_minor', { mode: 'number' }).notNull(),
    maxFulfillments: integer('max_fulfillments').notNull(),
    reservedMinor: bigint('reserved_minor', { mode: 'number' }).notNull().default(0),
    consumedMinor: bigint('consumed_minor', { mode: 'number' }).notNull().default(0),
    reservedCount: integer('reserved_count').notNull().default(0),
    consumedCount: integer('consumed_count').notNull().default(0),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('mandate_runtime_mandate_version_uq').on(t.mandateId, t.version),
    check('mandate_runtime_validity_ck', sql`${t.validUntil} > ${t.validFrom}`),
    check('mandate_runtime_limits_ck', sql`${t.maxPerPurchaseMinor} <= ${t.maxTotalMinor}`),
    check('mandate_runtime_fulfillments_ck', sql`${t.maxFulfillments} > 0`),
    check(
      'mandate_runtime_counters_ck',
      sql`${t.reservedMinor} >= 0 AND ${t.consumedMinor} >= 0 AND ${t.reservedCount} >= 0 AND ${t.consumedCount} >= 0`,
    ),
  ],
);

export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    airline: text('airline').notNull(),
    flightNumber: text('flight_number').notNull(),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    cabin: text('cabin').notNull(),
    departureAt: timestamp('departure_at', { withTimezone: true }).notNull(),
    arrivalAt: timestamp('arrival_at', { withTimezone: true }).notNull(),
    passengerCount: integer('passenger_count').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('AVAILABLE'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    source: text('source').notNull(),
    ...timestamps,
  },
  (t) => [
    index('offers_route_idx').on(t.merchantId, t.origin, t.destination),
    check('offers_amount_ck', sql`${t.amountMinor} >= 0`),
  ],
);

export const checkouts = pgTable(
  'checkouts',
  {
    id: uuid('id').primaryKey(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    cart: jsonb('cart').$type<Record<string, unknown>>().notNull(),
    cartHash: text('cart_hash').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('OPEN'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [check('checkouts_amount_ck', sql`${t.amountMinor} >= 0`)],
);

export const nonces = pgTable(
  'nonces',
  {
    id: uuid('id').primaryKey(),
    agentKeyId: uuid('agent_key_id')
      .notNull()
      .references(() => agentKeys.id),
    nonce: text('nonce').notNull(),
    requestDigest: text('request_digest').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('nonces_key_nonce_uq').on(t.agentKeyId, t.nonce)],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').primaryKey(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    state: text('state').notNull().default('IN_PROGRESS'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<unknown>(),
    ...timestamps,
  },
  (t) => [uniqueIndex('idempotency_scope_key_uq').on(t.scope, t.key)],
);

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey(),
    mandateId: uuid('mandate_id').references(() => mandates.id),
    mandateVersion: integer('mandate_version'),
    offerId: uuid('offer_id').references(() => offers.id),
    checkoutId: uuid('checkout_id').references(() => checkouts.id),
    agentId: uuid('agent_id').references(() => agents.id),
    agentKeyId: uuid('agent_key_id').references(() => agentKeys.id),
    state: text('state').notNull().default('RECEIVED'),
    decision: text('decision'),
    reasonCode: text('reason_code'),
    checklist: jsonb('checklist').$type<unknown[]>(),
    requestDigest: text('request_digest'),
    nonce: text('nonce'),
    amountMinor: bigint('amount_minor', { mode: 'number' }),
    currency: text('currency'),
    approvalRequestId: uuid('approval_request_id'),
    evidenceId: text('evidence_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index('executions_mandate_idx').on(t.mandateId)],
);

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id)
      .unique(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id),
    version: integer('version').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    state: text('state').notNull().default('RESERVED'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [check('reservations_amount_ck', sql`${t.amountMinor} >= 0`)],
);

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id),
    mandateVersion: integer('mandate_version').notNull(),
    checkoutId: uuid('checkout_id')
      .notNull()
      .references(() => checkouts.id),
    checkoutHash: text('checkout_hash').notNull(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id),
    reasonCode: text('reason_code').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    state: text('state').notNull().default('PENDING'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionEvidence: jsonb('decision_evidence').$type<Record<string, unknown>>(),
    consumedByExecutionId: uuid('consumed_by_execution_id'),
    ...timestamps,
  },
  (t) => [index('approval_requests_mandate_idx').on(t.mandateId)],
);

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey(),
  executionId: uuid('execution_id')
    .notNull()
    .references(() => executions.id)
    .unique(),
  provider: text('provider').notNull(),
  providerPaymentId: text('provider_payment_id'),
  providerTransactionId: text('provider_transaction_id'),
  state: text('state').notNull().default('CREATED'),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  lastEventId: text('last_event_id'),
  failureReason: text('failure_reason'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
});

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    executionId: uuid('execution_id'),
    payload: jsonb('payload').$type<unknown>().notNull(),
    processingState: text('processing_state').notNull().default('RECEIVED'),
    ...timestamps,
  },
  (t) => [uniqueIndex('webhook_events_provider_event_uq').on(t.provider, t.providerEventId)],
);

export const disputes = pgTable('disputes', {
  id: uuid('id').primaryKey(),
  executionId: uuid('execution_id')
    .notNull()
    .references(() => executions.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  reason: text('reason').notNull(),
  description: text('description'),
  state: text('state').notNull().default('OPEN'),
  resolution: jsonb('resolution').$type<Record<string, unknown>>(),
  evidenceBundleId: text('evidence_bundle_id'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...timestamps,
});

export const auditChainHeads = pgTable('audit_chain_heads', {
  stream: text('stream').primaryKey(),
  lastSequence: bigint('last_sequence', { mode: 'number' }).notNull().default(0),
  lastHash: text('last_hash').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    sequence: bigint('sequence', { mode: 'number' }).notNull().unique(),
    eventType: text('event_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    mandateId: uuid('mandate_id'),
    mandateVersion: integer('mandate_version'),
    executionId: uuid('execution_id'),
    checkoutId: uuid('checkout_id'),
    paymentId: uuid('payment_id'),
    reasonCode: text('reason_code'),
    summary: text('summary').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    previousHash: text('previous_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (t) => [
    index('audit_events_mandate_idx').on(t.mandateId),
    index('audit_events_execution_idx').on(t.executionId),
  ],
);
