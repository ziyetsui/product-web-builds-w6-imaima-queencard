import { useGsapReveal } from "@/hooks/useGsapReveal";

/**
 * Merged "How it works (3 steps)" + "Proof / data".
 * Top: 3 steps cards / Bottom: 3 proof stats.
 * No outer white panel.
 */

const steps = [
  {
    num: "01",
    title: "粘贴参考图",
    desc: "把你收藏的爆款图文直接粘进来，ima ima queencard 识别版式结构。",
  },
  {
    num: "02",
    title: "输入主题",
    desc: "告诉 ima ima queencard 你要做的方向和核心内容，几句话就够。",
  },
  {
    num: "03",
    title: "拿到成套图文",
    desc: "得到贴合平台语感的成套内容，可以直接发或继续批量出。",
  },
];

const proofs = [
  {
    img: "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/32ed008b-0618-44.jpg",
    alt: "铁血老太账号笔记封面",
    value: "一天涨粉 2W",
    desc: "「铁血老太」人设号 · 单日爆款",
    bg: "#e7db4c",
  },
  {
    img: "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/531322fb-7666-41.jpg",
    alt: "plog 博主 团子小鱼干 笔记封面",
    value: "月入 5W+",
    desc: "plog 博主 · 一个月 30+ 商单",
    bg: "#ace2df",
  },
  {
    img: "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/4c2bed52-57c0-41.jpg",
    alt: "女性成长博主 姐妹你可以 笔记封面",
    value: "9W 新增粉丝",
    desc: "不露脸女性成长号 · 一个月",
    bg: "#ef724f",
  },
];

export default function ProcessSection() {
  const ref = useGsapReveal<HTMLElement>();

  return (
    <section ref={ref} className="bg-canvas-pink border-t-2 border-charcoal px-4 md:px-10 py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto">
        <h2
          className="anim-title font-alfa text-charcoal mb-12 max-w-[820px]"
          style={{ fontSize: "clamp(32px, 4.5vw, 56px)", lineHeight: 0.98, letterSpacing: "-0.03em" }}
        >
          3 步从收藏爆款<br />到做出自己的内容
        </h2>

        {/* Steps */}
        <div className="anim-cards grid grid-cols-1 md:grid-cols-3 gap-5 mb-16">
          {steps.map((s) => (
            <article
              key={s.num}
              className="anim-card rounded-[30px] border-2 border-charcoal bg-surface-white p-6 flex flex-col gap-3 transition-transform hover:-translate-y-1"
            >
              <div className="w-10 h-10 rounded-full border-2 border-charcoal bg-pumpkin grid place-items-center font-alfa text-[15px]">
                {s.num}
              </div>
              <h3 className="font-manrope text-[20px] font-extrabold">{s.title}</h3>
              <p className="font-manrope text-[15px] leading-[1.55] text-charcoal/70">{s.desc}</p>
            </article>
          ))}
        </div>

        {/* Proof divider */}
        <div className="flex items-center gap-4 mb-8">
          <span className="font-manrope text-[13px] font-bold text-charcoal/50 uppercase tracking-wider">
            真实案例
          </span>
          <div className="flex-1 h-[2px] bg-charcoal/20" />
        </div>

        {/* Proof stats — polaroid style: image on top + caption below (lpalo.com inspired) */}
        <div className="anim-cards grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          {proofs.map((p) => (
            <article
              key={p.value}
              className="anim-card anim-scrub-card group rounded-[24px] border-2 border-charcoal bg-surface-white overflow-hidden flex flex-col transition-transform hover:-translate-y-1 will-change-transform"
            >
              {/* Image frame — tinted background fills empty space behind the screenshot */}
              <div
                className="border-b-2 border-charcoal aspect-[4/5] overflow-hidden flex items-center justify-center"
                style={{ background: p.bg }}
              >
                <img
                  src={p.img}
                  alt={p.alt}
                  loading="lazy"
                  className="w-full h-full object-cover object-top transition-transform duration-700 ease-out group-hover:scale-105"
                />
              </div>
              {/* Caption */}
              <div className="p-5">
                <strong className="font-alfa text-[26px] block mb-1 leading-none">{p.value}</strong>
                <div className="font-manrope text-[14px] leading-snug text-charcoal/75">{p.desc}</div>
              </div>
            </article>
          ))}
        </div>

        <p className="font-manrope text-[12px] mt-4 text-charcoal/40">
          以上为用户提供的公开案例素材，仅供参考。
        </p>
      </div>
    </section>
  );
}
