import { after } from "next/server";

import {
  regenerateImageTask,
  runImageGenerationTask,
} from "@/services/image-generation";

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
    after(() => {
      void runImageGenerationTask(user.id, task.taskId).catch((error) => {
        console.error("Image regeneration task failed:", error);
      });
    });

    return apiSuccess({
      ...task,
      redirectUrl: `/generated?taskId=${task.taskId}`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
