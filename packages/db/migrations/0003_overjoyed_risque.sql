ALTER TABLE "offers" ALTER COLUMN "airline" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ALTER COLUMN "flight_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ALTER COLUMN "origin" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ALTER COLUMN "destination" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ALTER COLUMN "cabin" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ALTER COLUMN "departure_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ALTER COLUMN "arrival_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ALTER COLUMN "passenger_count" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "kind" text DEFAULT 'flight' NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "search_query" text;