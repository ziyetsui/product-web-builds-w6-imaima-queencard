CREATE TYPE "public"."PaymentFulfillmentStatus" AS ENUM('PENDING', 'FULFILLED', 'SKIPPED', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TABLE "payment_fulfillments" (
	"id" serial PRIMARY KEY NOT NULL,
	"fulfillment_key" text NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"event_id" text,
	"event_type" text,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_session_id" text,
	"stripe_invoice_id" text,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"stripe_refund_id" text,
	"product_key" text,
	"stripe_price_id" text,
	"user_id" text,
	"credits" integer DEFAULT 0 NOT NULL,
	"credit_package_id" integer,
	"status" "PaymentFulfillmentStatus" DEFAULT 'PENDING' NOT NULL,
	"error_message" text,
	"metadata" jsonb,
	"fulfilled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "creem_subscriptions" CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_fulfillments_fulfillment_key_idx" ON "payment_fulfillments" USING btree ("fulfillment_key");--> statement-breakpoint
CREATE INDEX "payment_fulfillments_provider_idx" ON "payment_fulfillments" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "payment_fulfillments_user_id_idx" ON "payment_fulfillments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_fulfillments_event_id_idx" ON "payment_fulfillments" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "payment_fulfillments_status_idx" ON "payment_fulfillments" USING btree ("status");