import { useEffect, useRef } from "react";
import gsap from "gsap";

/**
 * Infinite horizontal marquee (lpalo.com flavor).
 * Continuous GSAP loop, hover-pauses, content duplicated for seamless wrap.
 */

const PHRASES = [
  "参考图驱动",
  "成套图文",
  "平台原生感",
  "副业友好",
  "不从空白开始",
  "把爆款做快",
  "粘贴 → 生成 → 发布",
  "30 秒批量出图",
];

function Track() {
  return (
    <div className="flex items-center shrink-0 gap-10 pr-10">
      {PHRASES.map((p) => (
        <span key={p} className="flex items-center gap-10">
          <span className="font-alfa text-charcoal text-[clamp(28px,4vw,56px)] leading-none whitespace-nowrap">
            {p}
          </span>
          <span className="inline-block w-3 h-3 rounded-full bg-pumpkin border-2 border-charcoal" />
        </span>
      ))}
    </div>
  );
}

export default function MarqueeBand() {
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!trackRef.current) return;
    const ctx = gsap.context(() => {
      const tween = gsap.to(trackRef.current, {
        xPercent: -50,
        duration: 28,
        ease: "none",
        repeat: -1,
      });
      const el = trackRef.current!;
      const onEnter = () => tween.timeScale(0.25);
      const onLeave = () => tween.timeScale(1);
      el.addEventListener("mouseenter", onEnter);
      el.addEventListener("mouseleave", onLeave);
      return () => {
        el.removeEventListener("mouseenter", onEnter);
        el.removeEventListener("mouseleave", onLeave);
      };
    });
    return () => ctx.revert();
  }, []);

  return (
    <section
      aria-label="features marquee"
      className="bg-lemon border-y-2 border-charcoal py-6 overflow-hidden"
    >
      <div ref={trackRef} className="flex w-max will-change-transform">
        <Track />
        <Track />
      </div>
    </section>
  );
}
