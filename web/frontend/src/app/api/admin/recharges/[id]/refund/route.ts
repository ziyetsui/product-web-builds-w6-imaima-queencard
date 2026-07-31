import { NextRequest } from "next/server";
import { ZodError } from "zod";

import {
  revokeAdminRecharge,
  revokeAdminRechargeSchema,
} from "@/services/admin-recharge";
import { requireSuperAdmin } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/error";
import { apiSuccess, handleApiError } from "@/lib/api/response";

function getRequestMeta(request: NextRequest) {
  return {
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const superAdminUser = await requireSuperAdmin(request);
    const params = await context.params;
    const orderId = Number(params.id);
    if (!Number.isFinite(orderId)) {
      throw new ApiError("Invalid recharge order id", 400);
    }

    const body = await request.json().catch(() => ({}));
    const input = revokeAdminRechargeSchema.parse(body);
    const result = await revokeAdminRecharge(
      superAdminUser,
      orderId,
      input,
      getRequestMeta(request)
    );

    return apiSuccess(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return handleApiError(
        new ApiError("Invalid refund payload", 400, error.flatten())
      );
    }
    return handleApiError(error);
  }
}
