"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ImageGenerationComposer,
  type ImageGenerationSeed,
} from "@/components/common/image-generation-composer";

export function ImageGenerationDialog({
  open,
  onOpenChange,
  seed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seed: ImageGenerationSeed | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-[920px] overflow-y-auto rounded-[14px] border-2 border-charcoal bg-canvas-pink p-0 shadow-[8px_8px_0_#000]">
        <DialogHeader className="sr-only">
          <DialogTitle>生成图片</DialogTitle>
          <DialogDescription>
            使用当前爆款图文的前三张参考图和提示词创建图片生成任务。
          </DialogDescription>
        </DialogHeader>
        {seed ? (
          <ImageGenerationComposer
            seed={seed}
            submitLabel="生成"
            className="border-0 shadow-none"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
