import { after } from "next/server";

import {
  createImageGenerationTask,
  listImageGenerationTasks,
  runImageGenerationTask,
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
    after(() => {
      void runImageGenerationTask(user.id, task.taskId).catch((error) => {
        console.error("Image generation task failed:", error);
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
