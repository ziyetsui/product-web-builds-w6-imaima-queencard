import { NextRequest } from "next/server";
import { ZodError } from "zod";

import {
  updateAdminUserNote,
  updateAdminUserNoteSchema,
} from "@/services/admin-recharge";
import { requireAdmin } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/error";
import { apiSuccess, handleApiError } from "@/lib/api/response";

function getRequestMeta(request: NextRequest) {
  return {
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  };
}

export async function POST(request: NextRequest) {
  try {
    const adminUser = await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const input = updateAdminUserNoteSchema.parse(body);
    const result = await updateAdminUserNote(
      adminUser,
      input,
      getRequestMeta(request)
    );

    return apiSuccess(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return handleApiError(
        new ApiError("Invalid note payload", 400, error.flatten())
      );
    }
    return handleApiError(error);
  }
}
