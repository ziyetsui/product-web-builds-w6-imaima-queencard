import { useGsapReveal } from "@/hooks/useGsapReveal";
import { DEFAULT_TRY_URL } from "@/lib/tryUrl";

export default function FinalCta() {
  const ref = useGsapReveal<HTMLElement>();

  return (
    <section
      ref={ref}
      id="cta"
      className="bg-pumpkin border-t-2 border-charcoal px-4 md:px-10 py-24 md:py-32"
    >
      <div className="max-w-[900px] mx-auto text-center">
        <h2
          className="anim-title font-alfa text-charcoal mb-6"
          style={{ fontSize: "clamp(36px, 6vw, 88px)", lineHeight: 0.95, letterSpacing: "-0.03em" }}
        >
          别再一张张抽卡了
        </h2>
        <p className="anim-fade font-manrope text-[17px] leading-[1.55] mb-10 text-charcoal/75 max-w-[560px] mx-auto">
          你已经积累了那么多收藏，是时候让它们真正派上用场了。
        </p>

        <div className="anim-fade flex flex-wrap gap-3 justify-center">
          <a
            href={DEFAULT_TRY_URL}
            className="px-[28px] py-[16px] rounded-pill border-2 border-charcoal bg-charcoal text-surface-white font-manrope text-[17px] font-bold transition-transform hover:-translate-y-[3px]"
          >
            立即试一版 →
          </a>
          <a
            href="#gallery"
            className="px-[28px] py-[16px] rounded-pill border-2 border-charcoal bg-surface-white font-manrope text-[17px] font-bold transition-transform hover:-translate-y-[2px]"
          >
            再看一次对比
          </a>
        </div>
      </div>
    </section>
  );
}
