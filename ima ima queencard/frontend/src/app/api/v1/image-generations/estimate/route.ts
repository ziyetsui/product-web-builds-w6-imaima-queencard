import { estimateImageGeneration } from "@/services/image-generation";

import { requireAuth } from "@/lib/api/auth";
import { apiSuccess, handleApiError } from "@/lib/api/response";

export async function POST(request: Request) {
  try {
    await requireAuth(request);
    const body = await request.json().catch(() => ({}));
    return apiSuccess(estimateImageGeneration(body));
  } catch (error) {
    return handleApiError(error);
  }
}
