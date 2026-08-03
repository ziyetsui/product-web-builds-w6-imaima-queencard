import {
  createImageGenerationTask,
  listImageGenerationTasks,
} from "@/services/image-generation";

import { requireAuth } from "@/lib/api/auth";
import { apiSuccess, handleApiError } from "@/lib/api/response";

export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 24);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const records = await listImageGenerationTasks(user.id, {
      query: url.searchParams.get("q") ?? url.searchParams.get("query"),
      status: url.searchParams.get("status"),
      limit,
      offset,
    });

    return apiSuccess(records);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const task = await createImageGenerationTask(user.id, body);

    return apiSuccess({
      ...task,
      statusUrl: `/api/v1/image-generations/${task.taskId}`,
      redirectUrl: `/generated?taskId=${task.taskId}`,
    }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
