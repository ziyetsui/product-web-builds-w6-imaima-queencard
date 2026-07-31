import { createStripeSession } from "@/services/billing";
import { requireAuth } from "@/lib/api/auth";
import { apiError, apiSuccess, handleApiError } from "@/lib/api/response";
import { getPricingProduct } from "@/config/pricing-products";

export async function POST(request: Request) {
  try {
    const user = await requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const productKey =
      typeof body.productKey === "string" ? body.productKey.trim() : "";

    if (!getPricingProduct(productKey)) {
      return Response.json(
        { success: false, error: { message: "Missing or invalid product key" } },
        { status: 400 }
      );
    }

    const session = await createStripeSession(user.id, productKey);
    if (!session.success) {
      return apiError(session.error || "Unable to create Stripe session", 400);
    }

    return apiSuccess(session);
  } catch (error) {
    return handleApiError(error);
  }
}
