import { NextRequest } from "next/server";

import { listAdminRechargeUsers } from "@/services/admin-recharge";
import { requireAdmin } from "@/lib/api/auth";
import { apiSuccess, handleApiError } from "@/lib/api/response";

function getNumberParam(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getBooleanParam(value: string | null) {
  return value === "1" || value === "true" || value === "yes";
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const data = await listAdminRechargeUsers({
      q: searchParams.get("q"),
      rechargeStatus: searchParams.get("rechargeStatus") as
        | "all"
        | "recharged"
        | "never_recharged"
        | null,
      lowBalance: getBooleanParam(searchParams.get("lowBalance")),
      page: getNumberParam(searchParams.get("page")),
      pageSize: getNumberParam(searchParams.get("pageSize")),
    });

    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error);
  }
}
