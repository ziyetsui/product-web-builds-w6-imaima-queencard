import { cn } from "@/lib/utils";

/**
 * Brand wordmark — the single source of truth for the "ima ima queencard"
 * logotype. The "Q" of "Queencard" is rendered in the Pinyon Script
 * calligraphic face (font-script), visually centred with the surrounding
 * Alfa Slab One caps (every.to-style embedded glyph).
 *
 * Sizing scales from the parent font-size (the Q is 2em), so callers only
 * need to set a text size + colour via `className`. Use `qClassName` to give
 * the Q its own colour on dark surfaces (e.g. `text-lemon`).
 */
export function Wordmark({
  className,
  qClassName,
}: {
  className?: string;
  qClassName?: string;
}) {
  return (
    <span className={cn("font-alfa tracking-[-0.015em]", className)}>
      ima ima{" "}
      <span
        className={cn(
          "font-script text-[2em] leading-none inline-block align-[-0.08em] -ml-[0.04em] -mr-[0.02em]",
          qClassName,
        )}
      >
        Q
      </span>
      ueencard
    </span>
  );
}
