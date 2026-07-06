import { env } from "@/payment/env.mjs";
import {
  handleCreemEvent,
  verifyCreemSignature,
  type CreemWebhookEvent,
} from "@/payment/creem-webhooks";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const payload = await req.text();
  const signature = req.headers.get("creem-signature");

  try {
    if (!verifyCreemSignature(payload, signature, env.CREEM_WEBHOOK_SECRET)) {
      return Response.json({ error: "Invalid Creem signature" }, { status: 400 });
    }

    const event = JSON.parse(payload) as CreemWebhookEvent;
    await handleCreemEvent(event);

    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error when handling Creem event: ${message}`);
    return Response.json({ error: message }, { status: 400 });
  }
}
