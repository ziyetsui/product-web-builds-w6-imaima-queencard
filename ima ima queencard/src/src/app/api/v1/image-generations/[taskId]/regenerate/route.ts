import { regenerateImageTask } from "@/services/image-generation";

import { requireAuth } from "@/lib/api/auth";
import { apiSuccess, handleApiError } from "@/lib/api/response";

export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { taskId } = await params;
    const task = await regenerateImageTask(user.id, taskId);

    return apiSuccess({
      ...task,
      statusUrl: `/api/v1/image-generations/${task.taskId}`,
      redirectUrl: `/generated?taskId=${task.taskId}`,
    }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
