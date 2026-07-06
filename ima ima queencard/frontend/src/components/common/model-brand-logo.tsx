import type { ImageGenerationBrandLogo } from "@/config/image-generation-models";
import { cn } from "@/lib/utils";

const logoImageSizeClass: Record<ImageGenerationBrandLogo["format"], string> = {
  symbol: "max-h-5 max-w-5",
  wordmark: "max-h-4 max-w-[38px]",
};

export function ModelBrandLogo({
  logo,
  active = false,
  className,
}: {
  logo: ImageGenerationBrandLogo;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid h-8 w-11 shrink-0 place-items-center rounded-[8px] border-2 border-charcoal overflow-hidden",
        logo.surface === "dark" ? "bg-charcoal" : "bg-surface-white",
        active ? "shadow-[2px_2px_0_#000]" : "shadow-none",
        className
      )}
      aria-hidden="true"
    >
      <img
        src={logo.src}
        alt=""
        className={cn("block object-contain", logoImageSizeClass[logo.format])}
        draggable={false}
      />
    </span>
  );
}
