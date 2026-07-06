import { NextResponse } from "next/server";

import { getGeneratedAssetForDownload } from "@/services/image-generation";

import { requireAuth } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { assetId } = await params;
    const asset = await getGeneratedAssetForDownload(user.id, assetId);

    return NextResponse.redirect(asset.storageUrl);
  } catch (error) {
    return handleApiError(error);
  }
}
