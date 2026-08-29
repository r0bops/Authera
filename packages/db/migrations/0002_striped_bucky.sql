ALTER TABLE "offers" ADD COLUMN "provider_offer_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "offers_provider_offer_idx" ON "offers" USING btree ("source","provider_offer_id");