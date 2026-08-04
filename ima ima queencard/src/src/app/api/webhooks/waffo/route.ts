import { after } from "next/server";
import type { WebhookEventData } from "@waffo/pancake-ts";

import { getWaffoClient } from "@/payment/waffo";
import {
  handleWaffoEvent,
  type WaffoWebhookEvent,
} from "@/payment/waffo-webhooks";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("x-waffo-signature");

  try {
    const event = getWaffoClient().webhooks.verify<WebhookEventData>(
      payload,
      signature
    ) as WaffoWebhookEvent;

    after(async () => {
      try {
        await handleWaffoEvent(event);
      } catch (error) {
        console.error("Error when handling Waffo event:", error);
      }
    });

    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Invalid Waffo webhook: ${message}`);
    return Response.json({ error: "Invalid Waffo signature" }, { status: 400 });
  }
}
