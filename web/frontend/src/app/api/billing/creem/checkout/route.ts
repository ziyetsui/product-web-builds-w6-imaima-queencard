import { getPricingProduct } from "@/config/pricing-products";
import { requireAuth } from "@/lib/api/auth";
import { apiError, apiSuccess, handleApiError } from "@/lib/api/response";
import { createCreemCheckout } from "@/services/billing";

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

    const session = await createCreemCheckout(user.id, productKey);
    if (!session.success) {
      return apiError(
        "error" in session && session.error
          ? session.error
          : "Unable to create Creem checkout",
        400
      );
    }

    return apiSuccess(session);
  } catch (error) {
    return handleApiError(error);
  }
}
