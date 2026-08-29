CREATE TABLE "agent_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"thumbprint" text NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_keys_thumbprint_unique" UNIQUE("thumbprint")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"profile_uri" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"mandate_id" uuid NOT NULL,
	"mandate_version" integer NOT NULL,
	"checkout_id" uuid NOT NULL,
	"checkout_hash" text NOT NULL,
	"offer_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decision_evidence" jsonb,
	"consumed_by_execution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_chain_heads" (
	"stream" text PRIMARY KEY NOT NULL,
	"last_sequence" bigint DEFAULT 0 NOT NULL,
	"last_hash" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigint NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"mandate_id" uuid,
	"mandate_version" integer,
	"execution_id" uuid,
	"checkout_id" uuid,
	"payment_id" uuid,
	"reason_code" text,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"previous_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_events_sequence_unique" UNIQUE("sequence")
);
--> statement-breakpoint
CREATE TABLE "checkouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offer_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"cart" jsonb NOT NULL,
	"cart_hash" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkouts_amount_ck" CHECK ("checkouts"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"description" text,
	"state" text DEFAULT 'OPEN' NOT NULL,
	"resolution" jsonb,
	"evidence_bundle_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mandate_id" uuid,
	"mandate_version" integer,
	"offer_id" uuid,
	"checkout_id" uuid,
	"agent_id" uuid,
	"agent_key_id" uuid,
	"state" text DEFAULT 'RECEIVED' NOT NULL,
	"decision" text,
	"reason_code" text,
	"checklist" jsonb,
	"request_digest" text,
	"nonce" text,
	"amount_minor" bigint,
	"currency" text,
	"approval_request_id" uuid,
	"evidence_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "human_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandate_runtime" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mandate_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"max_per_purchase_minor" bigint NOT NULL,
	"max_total_minor" bigint NOT NULL,
	"max_fulfillments" integer NOT NULL,
	"reserved_minor" bigint DEFAULT 0 NOT NULL,
	"consumed_minor" bigint DEFAULT 0 NOT NULL,
	"reserved_count" integer DEFAULT 0 NOT NULL,
	"consumed_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandate_runtime_validity_ck" CHECK ("mandate_runtime"."valid_until" > "mandate_runtime"."valid_from"),
	CONSTRAINT "mandate_runtime_limits_ck" CHECK ("mandate_runtime"."max_per_purchase_minor" <= "mandate_runtime"."max_total_minor"),
	CONSTRAINT "mandate_runtime_fulfillments_ck" CHECK ("mandate_runtime"."max_fulfillments" > 0),
	CONSTRAINT "mandate_runtime_counters_ck" CHECK ("mandate_runtime"."reserved_minor" >= 0 AND "mandate_runtime"."consumed_minor" >= 0 AND "mandate_runtime"."reserved_count" >= 0 AND "mandate_runtime"."consumed_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mandate_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mandate_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"policy_hash" text NOT NULL,
	"jws" text NOT NULL,
	"signing_kid" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "nonces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_key_id" uuid NOT NULL,
	"nonce" text NOT NULL,
	"request_digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"airline" text NOT NULL,
	"flight_number" text NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"cabin" text NOT NULL,
	"departure_at" timestamp with time zone NOT NULL,
	"arrival_at" timestamp with time zone NOT NULL,
	"passenger_count" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_amount_ck" CHECK ("offers"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"token_ref" text NOT NULL,
	"display_brand" text NOT NULL,
	"display_last4" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"provider_transaction_id" text,
	"state" text DEFAULT 'CREATED' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"last_event_id" text,
	"failure_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_execution_id_unique" UNIQUE("execution_id")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"mandate_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"state" text DEFAULT 'RESERVED' NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_execution_id_unique" UNIQUE("execution_id"),
	CONSTRAINT "reservations_amount_ck" CHECK ("reservations"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "signing_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"kid" text NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signing_keys_kid_unique" UNIQUE("kid")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"execution_id" uuid,
	"payload" jsonb NOT NULL,
	"processing_state" text DEFAULT 'RECEIVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_checkout_id_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_checkout_id_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_agent_key_id_agent_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."agent_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_sessions" ADD CONSTRAINT "human_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_runtime" ADD CONSTRAINT "mandate_runtime_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_versions" ADD CONSTRAINT "mandate_versions_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonces" ADD CONSTRAINT "nonces_agent_key_id_agent_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."agent_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_mandate_idx" ON "approval_requests" USING btree ("mandate_id");--> statement-breakpoint
CREATE INDEX "audit_events_mandate_idx" ON "audit_events" USING btree ("mandate_id");--> statement-breakpoint
CREATE INDEX "audit_events_execution_idx" ON "audit_events" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "executions_mandate_idx" ON "executions" USING btree ("mandate_id");--> statement-breakpoint
CREATE INDEX "human_sessions_user_idx" ON "human_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_scope_key_uq" ON "idempotency_records" USING btree ("scope","key");--> statement-breakpoint
CREATE UNIQUE INDEX "mandate_runtime_mandate_version_uq" ON "mandate_runtime" USING btree ("mandate_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "mandate_versions_mandate_version_uq" ON "mandate_versions" USING btree ("mandate_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "nonces_key_nonce_uq" ON "nonces" USING btree ("agent_key_id","nonce");--> statement-breakpoint
CREATE INDEX "offers_route_idx" ON "offers" USING btree ("merchant_id","origin","destination");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_uq" ON "webhook_events" USING btree ("provider","provider_event_id");