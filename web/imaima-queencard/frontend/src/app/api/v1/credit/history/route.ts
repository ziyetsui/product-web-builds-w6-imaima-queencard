import { NextRequest } from "next/server";

import { creditService, type CreditTransType } from "@/services/credit";

import { requireAuth } from "@/lib/api/auth";
import { apiSuccess, handleApiError } from "@/lib/api/response";

// Map database enum values to frontend expected format
const transTypeMapping: Record<CreditTransType, string> = {
  NEW_USER: "new_user",
  ORDER_PAY: "order_pay",
  SUBSCRIPTION: "subscription",
  VIDEO_CONSUME: "image_generate",
  REFUND: "refund",
  EXPIRED: "expired",
  SYSTEM_ADJUST: "admin_adjust",
};

const transTypeLabels: Record<CreditTransType, string> = {
  NEW_USER: "新用户赠送积分",
  ORDER_PAY: "积分包到账",
  SUBSCRIPTION: "订阅周期积分",
  VIDEO_CONSUME: "图片生成消耗",
  REFUND: "退款或失败释放",
  EXPIRED: "积分过期",
  SYSTEM_ADJUST: "系统调整",
};

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);

    const limit = Number.parseInt(searchParams.get("limit") || "20");
    const offset = Number.parseInt(searchParams.get("cursor") || searchParams.get("offset") || "0");

    const result = await creditService.getHistory(user.id, {
      limit,
      offset,
      transType: searchParams.get("type") as CreditTransType | undefined,
    });

    // Transform transType to frontend-expected format
    const transformedRecords = result.records.map((record) => ({
      id: record.id.toString(), // Ensure ID is string
      userId: record.userId,
      credits: record.credits,
      balanceAfter: record.balanceAfter,
      transType: transTypeMapping[record.transType] ?? record.transType.toLowerCase(),
      displayText: transTypeLabels[record.transType] ?? record.transType,
      videoUuid: record.videoUuid,
      remark: record.remark,
      createdAt: record.createdAt,
    }));

    const hasMore = offset + limit < result.total;
    const nextCursor = hasMore ? (offset + limit).toString() : null;

    return apiSuccess({
      transactions: transformedRecords,
      total: result.total,
      hasMore,
      nextCursor,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
