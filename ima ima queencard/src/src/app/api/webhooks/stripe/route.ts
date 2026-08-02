import { NextResponse, type NextRequest } from "next/server";

import { handleEvent, stripe, type Stripe } from "@/payment";

import { env } from "@/env.mjs";

const handler = async (req: NextRequest) => {
  const payload = await req.text();
  const signature = req.headers.get("Stripe-Signature");
  if (!signature || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured" },
      { status: 400 }
    );
  }
  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    ) as Stripe.DiscriminatedEvent;
    await handleEvent(event);

    console.log("✅ Handled Stripe Event", event.type);
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.log(`❌ Error when handling Stripe Event: ${message}`);
    return NextResponse.json({ error: message }, { status: 400 });
  }
};

export function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export { handler as POST };
