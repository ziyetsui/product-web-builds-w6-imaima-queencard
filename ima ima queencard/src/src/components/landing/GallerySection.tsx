import { useGsapReveal } from "@/hooks/useGsapReveal";

/** Real image thumbnail with hover zoom (lpalo.com style). */
function ImgCard({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <div
      className={`group rounded-[10px] border-2 border-charcoal overflow-hidden flex-shrink-0 ${className}`}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        crossOrigin="anonymous"
        className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
      />
    </div>
  );
}

// Row data — all 3 rows now have real images
const comparisons = [
  {
    type: "知识拆解型",
    tags: ["版式像", "语感对", "可批量"],
    // Real images
    inputImg: "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/73cc8ca1-1646-45.jpg",
    outputImgs: [
      "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/d68f9898-29ff-43.png",
      "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/11665167-054c-47.png",
      "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/610557ec-5ed3-45.png",
    ],
  },
  {
    type: "情绪疗愈型",
    tags: ["版式像", "语感对", "可批量"],
    inputImg: "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/f1f302bd-5b7c-40.jpg",
    outputImgs: [
      "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/743a2f7d-8e4c-48.png",
      "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/1f2e891a-2d46-42.png",
      "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/9f05a5d8-8818-4c.png",
    ],
  },
  {
    type: "清单种草型",
    tags: ["版式像", "语感对", "可批量"],
    inputImg: "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/3d2a4d4d-5d4f-40.jpg",
    outputImgs: [
      "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/9fd4bc21-8014-4b.png",
      "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/951918b9-3b5a-4a.png",
      "https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100000253/466d7782-e718-4b.png",
    ],
  },
];

export default function GallerySection() {
  const ref = useGsapReveal<HTMLElement>();

  return (
    <section ref={ref} id="gallery" className="bg-surface-white border-t-2 border-charcoal px-4 md:px-10 py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto">
        <h2
          className="anim-title font-alfa text-charcoal mb-12 max-w-[820px]"
          style={{ fontSize: "clamp(32px, 4.5vw, 56px)", lineHeight: 0.98, letterSpacing: "-0.03em" }}
        >
          你给参考图<br />ima ima queencard 给你成套结果
        </h2>

        <div className="anim-cards flex flex-col gap-5">
          {comparisons.map((item) => (
            <article
              key={item.type}
              className="anim-card anim-scrub-card rounded-[30px] border-2 border-charcoal bg-canvas-pink p-5 md:p-6 will-change-transform"
            >
              <div className="flex flex-col md:flex-row md:items-center gap-5">
                {/* Left: Reference image */}
                <div className="flex flex-col items-center gap-2 shrink-0">
                  <span className="font-manrope text-[12px] font-bold text-charcoal/50">参考图</span>
                  <ImgCard
                    src={item.inputImg}
                    alt={`${item.type} 参考图`}
                    className="w-[90px] h-[120px] md:w-[100px] md:h-[130px]"
                  />
                </div>

                {/* Arrow */}
                <div className="font-alfa text-[28px] text-charcoal/25 hidden md:block">→</div>

                {/* Middle: ima ima queencard output images */}
                <div className="flex flex-col gap-2">
                  <span className="font-manrope text-[12px] font-bold text-charcoal/50">ima ima queencard 结果</span>
                  <div className="flex gap-2">
                    {item.outputImgs.map((url, i) => (
                      <ImgCard
                        key={i}
                        src={url}
                        alt={`${item.type} 输出 ${i + 1}`}
                        className="w-[70px] h-[90px] md:w-[80px] md:h-[105px]"
                      />
                    ))}
                  </div>
                </div>

                {/* Right: Label + Tags */}
                <div className="flex-1 min-w-[160px]">
                  <div className="font-manrope text-[18px] font-extrabold mb-[10px]">{item.type}</div>
                  <div className="flex flex-wrap gap-2">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-[12px] py-[6px] rounded-pill border-2 border-charcoal bg-surface-white font-manrope text-[12px] font-bold"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>

        <p className="anim-fade font-manrope text-[13px] mt-6 text-charcoal/45">
          以上为真实案例素材，实际效果以产品生成结果为准。
        </p>
      </div>
    </section>
  );
}
