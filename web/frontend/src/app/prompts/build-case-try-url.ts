import { buildPromptTryUrl } from "@/lib/tryUrl";
import type { XhsPromptCase } from "@/data/xhsPromptCases";

function imagesFor(item: XhsPromptCase) {
  return item.images.length > 0 ? item.images : [item.image];
}

function referenceImagesForGenerate(item: XhsPromptCase) {
  return imagesFor(item).slice(0, 3);
}

export function buildCaseTryUrl(item: XhsPromptCase, prompt: string) {
  return buildPromptTryUrl({
    templateId: item.id,
    prompt,
    referenceImage: item.image,
    referenceImages: referenceImagesForGenerate(item),
    noteUrl: item.noteUrl,
    authorUrl: item.authorUrl,
    sourceCaseId: item.id,
    sourceCaseCategory: item.category,
    sourceNoteUrl: item.noteUrl,
    sourceAuthorUrl: item.authorUrl,
  });
}
