import { getImageGenerationTask } from "@/services/image-generation";

import { requireAuth } from "@/lib/api/auth";
import { apiSuccess, handleApiError } from "@/lib/api/response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { taskId } = await params;
    const task = await getImageGenerationTask(user.id, taskId);
    return apiSuccess(task);
  } catch (error) {
    return handleApiError(error);
  }
}
