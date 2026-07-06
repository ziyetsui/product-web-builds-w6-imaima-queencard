ALTER TABLE "Customer" ADD COLUMN "billing_provider" text;--> statement-breakpoint
ALTER TABLE "Customer" ADD COLUMN "billing_customer_id" text;--> statement-breakpoint
ALTER TABLE "Customer" ADD COLUMN "billing_subscription_id" text;--> statement-breakpoint
ALTER TABLE "Customer" ADD COLUMN "billing_product_id" text;--> statement-breakpoint
ALTER TABLE "Customer" ADD COLUMN "billing_current_period_end" timestamp;--> statement-breakpoint
ALTER TABLE "payment_fulfillments" ADD COLUMN "provider_customer_id" text;--> statement-breakpoint
ALTER TABLE "payment_fulfillments" ADD COLUMN "provider_subscription_id" text;--> statement-breakpoint
ALTER TABLE "payment_fulfillments" ADD COLUMN "provider_checkout_id" text;--> statement-breakpoint
ALTER TABLE "payment_fulfillments" ADD COLUMN "provider_order_id" text;--> statement-breakpoint
ALTER TABLE "payment_fulfillments" ADD COLUMN "provider_transaction_id" text;--> statement-breakpoint
ALTER TABLE "payment_fulfillments" ADD COLUMN "provider_refund_id" text;--> statement-breakpoint
ALTER TABLE "payment_fulfillments" ADD COLUMN "provider_dispute_id" text;--> statement-breakpoint
ALTER TABLE "payment_fulfillments" ADD COLUMN "provider_product_id" text;