import { NextResponse } from "next/server";

import { getGeneratedAssetForDownload } from "@/services/image-generation";

import { requireAuth } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/response";

function extensionForMimeType(mimeType: string) {
  return mimeType.split("/")[1]?.replace(/[^a-z0-9+.-]/gi, "") || "png";
}

function imageResponse(asset: Awaited<ReturnType<typeof getGeneratedAssetForDownload>>) {
  const fallbackMimeType = asset.mimeType || "image/png";
  const [dataUrlMeta = "", dataUrlData = ""] = asset.storageUrl.split(",", 2);
  const isDataUrl = dataUrlMeta.startsWith("data:");
  const dataUrlMimeType = dataUrlMeta.match(/^data:([^;]+)/)?.[1];
  const isBase64DataUrl = dataUrlMeta.includes(";base64");
  const body = isDataUrl
    ? isBase64DataUrl
      ? Buffer.from(dataUrlData, "base64")
      : Buffer.from(decodeURIComponent(dataUrlData))
    : asset.b64Json
      ? Buffer.from(asset.b64Json, "base64")
      : null;

  if (!body) return null;

  const mimeType = dataUrlMimeType || fallbackMimeType;
  const extension = extensionForMimeType(mimeType);

  return new Response(body, {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `inline; filename="${asset.id}.${extension}"`,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { assetId } = await params;
    const asset = await getGeneratedAssetForDownload(user.id, assetId);

    const inlineImage = imageResponse(asset);
    if (inlineImage) return inlineImage;

    return NextResponse.redirect(asset.storageUrl);
  } catch (error) {
    return handleApiError(error);
  }
}
