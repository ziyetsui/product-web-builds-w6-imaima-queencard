import { useGsapReveal } from "@/hooks/useGsapReveal";

/**
 * Merged Pain + Solution section.
 * Left column: pain points / right column: ima ima queencard's approach.
 * No outer white panel — cards float directly on canvas.
 */
export default function ContrastSection() {
  const ref = useGsapReveal<HTMLElement>();

  return (
    <section ref={ref} className="bg-canvas-pink border-t-2 border-charcoal px-4 md:px-10 py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto">
        <h2
          className="anim-title font-alfa text-charcoal mb-12 max-w-[820px]"
          style={{ fontSize: "clamp(32px, 4.5vw, 56px)", lineHeight: 0.98, letterSpacing: "-0.03em" }}
        >
          你缺的不是灵感<br />是把爆款做快的工具
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Pain */}
          <article className="anim-from-left rounded-[30px] border-2 border-charcoal bg-surface-white p-7">
            <div className="inline-block px-3 py-1 rounded-pill border-2 border-charcoal bg-canvas-pink font-manrope text-[12px] font-bold mb-5">
              现状
            </div>
            <h3 className="font-manrope text-[22px] font-extrabold mb-4 leading-tight">
              真正劝退人的，是这套重流程
            </h3>
            <ul className="font-manrope text-[16px] leading-[1.8] space-y-1.5 text-charcoal/75">
              <li>· 一张张拆参考图</li>
              <li>· 一页页写标题和文案</li>
              <li>· 一次次抽卡筛图</li>
              <li>· 反复手工调版式，还不像平台内容</li>
            </ul>
          </article>

          {/* Solution */}
          <article className="anim-from-right rounded-[30px] border-2 border-charcoal bg-seafoam p-7">
            <div className="inline-block px-3 py-1 rounded-pill border-2 border-charcoal bg-surface-white font-manrope text-[12px] font-bold mb-5">
              ima ima queencard 的做法
            </div>
            <h3 className="font-manrope text-[22px] font-extrabold mb-4 leading-tight">
              从参考图直接到可发图文
            </h3>
            <ul className="font-manrope text-[16px] leading-[1.8] space-y-1.5 text-charcoal/80">
              <li>· 参考图驱动，不从空白 prompt 开始</li>
              <li>· 抓版式结构和信息节奏</li>
              <li>· 平台语感贴近，不像 AI 海报</li>
              <li>· 成套生成，直接发、连续发、批量发</li>
            </ul>
          </article>
        </div>

        <p className="anim-words font-manrope text-[18px] md:text-[22px] mt-12 text-charcoal/85 max-w-[760px] font-semibold leading-[1.5]">
          {"很多人不是输在不会做内容，而是输在做内容太慢，慢到根本坚持不下去。".split("").map((c, i) => (
            <span key={i} className="inline-block">{c}</span>
          ))}
        </p>
      </div>
    </section>
  );
}
