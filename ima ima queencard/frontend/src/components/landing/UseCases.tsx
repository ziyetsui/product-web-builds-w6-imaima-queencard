import { useGsapReveal } from "@/hooks/useGsapReveal";

// Restrained palette: only seafoam / lemon / pumpkin / white — repeating
const cases = [
  { title: "知识拆解号", desc: "专业知识做成图文，更易被搜索收藏", bg: "#ffffff", image: "/semiconductor.jpg" },
  { title: "情绪疗愈号", desc: "情感文案配套版式，更有阅读感", bg: "#ace2df", image: "/energy_field.jpg" },
  { title: "种草清单号", desc: "好物清单版式统一，更像测评博主", bg: "#ffffff", image: "/autumn_items.jpg" },
  { title: "副业教程号", desc: "拆解经验输出，图文比视频更易起步", bg: "#e7db4c", image: "/liver_health.jpg" },
  { title: "本地获客号", desc: "门店、服务、活动图文，直接导流", bg: "#ffffff", image: "/local_business.jpg" },
  { title: "海外 Carousel", desc: "同样的逻辑适配海外图文格式", bg: "#ace2df", image: "/overseas_carousel.jpg" },
];

export default function UseCases() {
  const ref = useGsapReveal<HTMLElement>();

  return (
    <section ref={ref} id="cases" className="bg-canvas-pink border-t-2 border-charcoal px-4 md:px-10 py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto">
        <div className="flex flex-col md:flex-row justify-between gap-6 items-start md:items-end mb-12">
          <h2
            className="anim-title font-alfa text-charcoal"
            style={{ fontSize: "clamp(32px, 4.5vw, 56px)", lineHeight: 0.98, letterSpacing: "-0.03em" }}
          >
            这些方向<br />更适合用 ima ima queencard 放大
          </h2>
          <p className="anim-fade font-manrope text-[15px] max-w-[360px] leading-[1.55] text-charcoal/65">
            只要核心模式是「靠图文积累人群」，ima ima queencard 都能帮你快起来。
          </p>
        </div>

        <div className="anim-cards grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {cases.map((c) => (
            <article
              key={c.title}
              className="anim-card rounded-[24px] border-2 border-charcoal p-5 transition-transform hover:-translate-y-1 flex flex-col justify-between"
              style={{ background: c.bg }}
            >
              <div>
                <h3 className="font-manrope text-[19px] font-extrabold mb-[8px]">{c.title}</h3>
                <p className="font-manrope text-[14px] leading-[1.5] text-charcoal/70 mb-4">{c.desc}</p>
              </div>
              {c.image && (
                <div className="mt-auto border-2 border-charcoal rounded-xl overflow-hidden bg-white">
                  <img src={c.image} alt={c.title} className="w-full h-auto object-cover" />
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
