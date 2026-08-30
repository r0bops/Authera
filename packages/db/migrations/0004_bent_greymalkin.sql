CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"booking_reference" text,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"live_mode" boolean,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_execution_id_unique" UNIQUE("execution_id"),
	CONSTRAINT "bookings_amount_ck" CHECK ("bookings"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "traveler_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"given_name" text NOT NULL,
	"family_name" text NOT NULL,
	"born_on" text NOT NULL,
	"gender" text NOT NULL,
	"title" text NOT NULL,
	"email" text NOT NULL,
	"phone_number" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traveler_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD CONSTRAINT "traveler_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_provider_order_uq" ON "bookings" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE INDEX "bookings_offer_idx" ON "bookings" USING btree ("offer_id");