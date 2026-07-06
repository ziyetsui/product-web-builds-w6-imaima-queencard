import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MouseEvent } from "react";

import { cn } from "@/lib/utils";

type BrandedCarouselControlsProps = {
  count: number;
  selectedIndex: number;
  ariaLabel: string;
  onPrevious: (event: MouseEvent<HTMLButtonElement>) => void;
  onNext: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
};

export function BrandedCarouselControls({
  count,
  selectedIndex,
  ariaLabel,
  onPrevious,
  onNext,
  className,
}: BrandedCarouselControlsProps) {
  const disabled = count <= 1;

  const navButtonClass =
    "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-charcoal transition-colors hover:bg-lemon disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent";

  return (
    <div
      className={cn(
        "pointer-events-auto absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border-2 border-charcoal bg-surface-white/92 px-1 py-1 shadow-brand-sm backdrop-blur-[2px]",
        className
      )}
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        onClick={onPrevious}
        disabled={disabled}
        className={navButtonClass}
        aria-label="上一张图"
      >
        <ChevronLeft size={15} aria-hidden="true" strokeWidth={2.6} />
      </button>

      <span className="min-w-[44px] px-1.5 text-center font-mono text-[11px] font-bold tabular-nums text-charcoal">
        {selectedIndex + 1}
        <span className="text-charcoal/40"> / {count}</span>
      </span>

      <button
        type="button"
        onClick={onNext}
        disabled={disabled}
        className={navButtonClass}
        aria-label="下一张图"
      >
        <ChevronRight size={15} aria-hidden="true" strokeWidth={2.6} />
      </button>
    </div>
  );
}
