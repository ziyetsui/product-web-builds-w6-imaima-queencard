import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DEFAULT_TRY_URL } from "@/lib/tryUrl";

gsap.registerPlugin(ScrollTrigger);

// ─── Design Tokens (from lpalo/variables.css) ────────────────────────────────
const TOKEN = {
  seafoam:   "#ace2df",
  lemon:     "#e7db4c",
  pumpkin:   "#ef724f",
  lavender:  "#e69dff",
  springGreen: "#6ed311",
  skyBlue:   "#84bfff",
  charcoal:  "#000000",
  canvas:    "#f6e0db",
  white:     "#ffffff",
} as const;

// ─── Cycling words ────────────────────────────────────────────────────────────
const WORDS = ["涨粉", "变现", "爆款", "出圈", "副业"];
const WORD_SCROLL_PX = 500; // px of scroll per word step

// ─── Starburst clip-path (24-point spiky star) ───────────────────────────────
const STARBURST_PATH =
  "polygon(50% 2%,53% 15%,60% 6%,61% 19%,70% 9%,69% 23%,79% 15%,76% 28%," +
  "87% 23%,82% 35%,95% 33%,88% 44%,100% 45%,91% 54%,100% 59%,89% 64%," +
  "97% 72%,85% 74%,90% 84%,78% 84%,80% 95%,68% 92%,67% 100%,56% 94%," +
  "50% 100%,44% 94%,33% 100%,32% 92%,20% 95%,22% 84%,10% 84%,15% 74%," +
  "3% 72%,11% 64%,0% 59%,9% 54%,0% 45%,12% 44%,5% 33%,18% 35%," +
  "13% 23%,24% 28%,21% 15%,31% 23%,30% 9%,39% 19%,40% 6%,47% 15%)";

// ─── Animated starburst splat ─────────────────────────────────────────────────
function Starburst({
  posStyle,
  bg,
  number,
  suffix,
  label,
  size = 200,
  delay = 0,
}: {
  posStyle: React.CSSProperties;
  bg: string;
  number: string;
  suffix?: string;
  label: string;
  size?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ctx = gsap.context(() => {
      // Slow continuous rotation + gentle bob
      gsap.to(el, {
        rotate: 360,
        duration: 22,
        ease: "none",
        repeat: -1,
      });
      gsap.to(el, {
        y: "-=14",
        duration: 3.2 + Math.random() * 0.6,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        delay,
      });
      // Scroll parallax at 0.3x speed
      gsap.to(el, {
        y: "+=120",
        ease: "none",
        scrollTrigger: {
          trigger: document.body,
          start: "top top",
          end: "bottom bottom",
          scrub: 1,
        },
      });
      
      // Hover physics
      const onEnter = () => gsap.to(el, { scale: 1.12, duration: 0.3, ease: "power2.out" });
      const onLeave = () => gsap.to(el, { scale: 1, duration: 0.4, ease: "power2.out" });
      el.addEventListener("mouseenter", onEnter);
      el.addEventListener("mouseleave", onLeave);
      
      return () => {
        el.removeEventListener("mouseenter", onEnter);
        el.removeEventListener("mouseleave", onLeave);
      };
    });
    return () => ctx.revert();
  }, [delay]);



  return (
    <div
      ref={ref}
      className="hero-float absolute hidden md:flex items-center justify-center will-change-transform"
      style={{
        width: size,
        height: size,
        clipPath: STARBURST_PATH,
        background: bg,
        ...posStyle,
      }}
    >
      {/* Counter-rotate content so text stays upright */}
      <div
        className="flex flex-col items-center text-center"
        style={{ transform: "rotate(-360deg)", animation: "counter-rotate 22s linear infinite" }}
      >
        <span
          className="font-alfa text-charcoal leading-none"
          style={{ fontSize: size * 0.22 }}
        >
          {number}
          {suffix && (
            <span style={{ fontSize: size * 0.13 }}>{suffix}</span>
          )}
        </span>
        <span
          className="font-manrope font-bold text-charcoal"
          style={{ fontSize: size * 0.09, opacity: 0.75, marginTop: 2 }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

// ─── Floating stat badge (count-up + bob) ─────────────────────────────────────
function StatBadge({
  posStyle,
  bg,
  value,
  suffix,
  label,
  delay = 0,
  duration = 2.0,
}: {
  posStyle: React.CSSProperties;
  bg: string;
  value: number;
  suffix: string;
  label: string;
  delay?: number;
  duration?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ref.current || !numRef.current) return;
    const numEl = numRef.current;
    const ctx = gsap.context(() => {
      gsap.to(ref.current, {
        y: "-=9",
        duration: 3.4 + Math.random() * 0.8,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        delay: delay + 0.4,
      });
      const obj = { n: 0 };
      gsap.to(obj, {
        n: value,
        duration,
        delay: delay + 0.9,
        ease: "power2.out",
        onUpdate: () => { numEl.textContent = Math.round(obj.n).toString(); },
      });
    });
    return () => ctx.revert();
  }, [value, delay, duration]);

  return (
    <div
      ref={ref}
      className="hero-float absolute hidden md:flex flex-col items-start will-change-transform"
      style={{
        background: bg,
        border: `2px solid ${TOKEN.charcoal}`,
        borderRadius: 22,
        padding: "14px 18px 12px",
        minWidth: 150,
        boxShadow: "5px 5px 0 rgba(0,0,0,0.12)",
        ...posStyle,
      }}
    >
      <div className="flex items-end gap-[3px] leading-none mb-[5px]">
        <span ref={numRef} className="font-alfa" style={{ fontSize: 36, lineHeight: 1, color: TOKEN.charcoal }}>
          0
        </span>
        <span className="font-alfa" style={{ fontSize: 22, lineHeight: 1.2, color: TOKEN.charcoal }}>
          {suffix}
        </span>
      </div>
      <span className="font-manrope font-bold" style={{ fontSize: 13, color: TOKEN.charcoal, opacity: 0.65 }}>
        {label}
      </span>
    </div>
  );
}

// ─── Parallax doodle (SVG line-art style icon) ───────────────────────────────
function ParallaxDoodle({
  posStyle,
  speed = 0.3,
  delay = 0,
  children,
}: {
  posStyle: React.CSSProperties;
  speed?: number;  // 0.1 = slow (near), 0.8 = fast (far)
  delay?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ctx = gsap.context(() => {
      // Idle bob
      gsap.to(el, {
        y: "-=10",
        duration: 2.8 + Math.random() * 0.8,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        delay,
      });
      // Scroll parallax at `speed`× normal speed
      gsap.to(el, {
        y: `+=${300 * speed}`,
        ease: "none",
        scrollTrigger: {
          trigger: document.body,
          start: "top top",
          end: "bottom bottom",
          scrub: 1,
        },
      });
    });
    return () => ctx.revert();
  }, [speed, delay]);

  return (
    <div
      ref={ref}
      className="hero-float absolute hidden md:flex items-center justify-center will-change-transform"
      style={{ width: 68, height: 68, ...posStyle }}
    >
      {children}
    </div>
  );
}

// ─── SVG doodle icons ──────────────────────────────────────────────────────────
const PlanetDoodle = () => (
  <svg viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 68, height: 68 }}>
    <circle cx="34" cy="34" r="14" stroke="#000" strokeWidth="2.5" fill={TOKEN.seafoam} />
    <ellipse cx="34" cy="34" rx="30" ry="10" stroke="#000" strokeWidth="2.5" fill="none" />
    <circle cx="40" cy="26" r="3" fill={TOKEN.lemon} stroke="#000" strokeWidth="1.5" />
  </svg>
);

const PencilDoodle = () => (
  <svg viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 54, height: 54 }}>
    <rect x="18" y="8" width="12" height="44" rx="3" fill={TOKEN.lemon} stroke="#000" strokeWidth="2.2" />
    <polygon points="18,52 30,52 24,62" fill={TOKEN.pumpkin} stroke="#000" strokeWidth="2.2" strokeLinejoin="round" />
    <rect x="18" y="8" width="12" height="8" rx="3" fill={TOKEN.lavender} stroke="#000" strokeWidth="2.2" />
    <line x1="18" y1="52" x2="30" y2="52" stroke="#000" strokeWidth="2.2" />
  </svg>
);

const StarDoodle = () => (
  <svg viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 52, height: 52 }}>
    <polygon
      points="34,6 39,26 60,26 43,39 49,60 34,47 19,60 25,39 8,26 29,26"
      fill={TOKEN.lemon} stroke="#000" strokeWidth="2.5" strokeLinejoin="round"
    />
  </svg>
);

const EraserDoodle = () => (
  <svg viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 56, height: 56 }}>
    <rect x="8" y="24" width="36" height="22" rx="4" fill={TOKEN.lavender} stroke="#000" strokeWidth="2.2" />
    <rect x="8" y="24" width="16" height="22" rx="4" fill={TOKEN.pumpkin} stroke="#000" strokeWidth="2.2" />
    <line x1="8" y1="46" x2="44" y2="46" stroke="#000" strokeWidth="2.2" />
    <line x1="24" y1="24" x2="24" y2="46" stroke="#000" strokeWidth="2.2" />
  </svg>
);

// ─── Magnetic CTA ─────────────────────────────────────────────────────────────
function MagBtn({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      gsap.to(el, { x: (e.clientX - (r.left + r.width / 2)) * 0.25, y: (e.clientY - (r.top + r.height / 2)) * 0.35, duration: 0.45, ease: "power2.out" });
    };
    const onLeave = () => gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.4)" });
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => { el.removeEventListener("mousemove", onMove); el.removeEventListener("mouseleave", onLeave); };
  }, []);

  return (
    <a
      ref={ref}
      href={href}
      className="inline-block will-change-transform font-manrope font-bold"
      style={{
        padding: "14px 28px",
        borderRadius: 999,
        border: `2px solid ${TOKEN.charcoal}`,
        background: primary ? TOKEN.pumpkin : TOKEN.white,
        color: TOKEN.charcoal,
        fontSize: 16,
        textDecoration: "none",
      }}
    >
      {children}
    </a>
  );
}

// ─── Word-swap — counter-rotate keyframe injected once ───────────────────────
const KEYFRAME_INJECTED = { done: false };
function injectCounterRotate() {
  if (KEYFRAME_INJECTED.done || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = `@keyframes counter-rotate { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }`;
  document.head.appendChild(style);
  KEYFRAME_INJECTED.done = true;
}

// ─── Hero Section ─────────────────────────────────────────────────────────────
export default function HeroSection() {
  const sectionRef    = useRef<HTMLElement>(null);
  const wordRef       = useRef<HTMLSpanElement>(null);
  const pillRef       = useRef<HTMLSpanElement>(null);
  const wordIndexRef  = useRef(0);
  const [displayWord, setDisplayWord] = useState(WORDS[0]);
  const [exiting, setExiting]         = useState(false);

  // ── Inject counter-rotate keyframe ─────────────────────────────────────────
  useEffect(() => { injectCounterRotate(); }, []);

  // ── Scroll-driven word-swap (GSAP ScrollTrigger pin) ───────────────────────
  useEffect(() => {
    if (!sectionRef.current) return;

    const ctx = gsap.context(() => {
      // ── Entrance stagger ─────────────────────────────────────────────────
      gsap
        .timeline({ delay: 0.15 })
        .from(".hero-eyebrow", { y: 14, opacity: 0, duration: 0.5, ease: "power2.out" })
        .from(".hero-h1-inner", { y: 30, opacity: 0, duration: 0.85, ease: "power3.out" }, "-=0.1")
        .from(".hero-sub", { y: 18, opacity: 0, duration: 0.55, ease: "power2.out" }, "-=0.4")
        .from(".hero-cta > *", { y: 16, opacity: 0, duration: 0.45, stagger: 0.08, ease: "power2.out" }, "-=0.3")
        .from(".hero-float", { scale: 0.5, opacity: 0, duration: 0.6, stagger: 0.055, ease: "back.out(1.9)" }, "-=0.35");

      // ── ScrollTrigger pin: word cycles on scroll ─────────────────────────
      const totalScrollHeight = WORDS.length * WORD_SCROLL_PX;

      ScrollTrigger.create({
        trigger: sectionRef.current,
        start: "top top",
        end: `+=${totalScrollHeight}`,
        pin: true,
        pinSpacing: true,
        onUpdate: (self) => {
          const newIdx = Math.min(
            Math.floor(self.progress * WORDS.length),
            WORDS.length - 1
          );
          if (newIdx !== wordIndexRef.current) {
            wordIndexRef.current = newIdx;
            // Animate pill + word: exit up, enter from below
            if (wordRef.current && pillRef.current) {
              gsap.fromTo(
                wordRef.current,
                { y: 30, opacity: 0, scaleY: 0.7 },
                { y: 0,  opacity: 1, scaleY: 1, duration: 0.32, ease: "back.out(1.5)" }
              );
              gsap.fromTo(
                pillRef.current,
                { scaleX: 0.7, opacity: 0 },
                { scaleX: 1,   opacity: 1, duration: 0.28, ease: "power2.out" }
              );
            }
            setDisplayWord(WORDS[newIdx]);
          }
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="top"
      className="relative bg-canvas-pink px-4 md:px-10 pt-32 pb-24 md:pt-40 md:pb-36"
      style={{ overflow: "visible" }}
    >
      {/* ── Starburst badge: 涨粉 ─────────────────────────────────────────── */}
      <Starburst
        posStyle={{ top: 120, left: "14%" }}
        bg={TOKEN.pumpkin}
        number="10万"
        suffix="+"
        label="单日涨粉"
        size={188}
        delay={1.2}
      />

      {/* ── Stat badge: 变现 ──────────────────────────────────────────────── */}
      <StatBadge
        posStyle={{ top: 150, right: "14%" }}
        bg={TOKEN.lemon}
        value={5}
        suffix="W+"
        label="月均变现"
        delay={1.4}
        duration={1.6}
      />

      {/* ── Stat badge: 出图速度 ──────────────────────────────────────────── */}
      <StatBadge
        posStyle={{ bottom: 140, right: "13%" }}
        bg={TOKEN.lavender}
        value={30}
        suffix="秒"
        label="批量出图"
        delay={1.6}
        duration={1.2}
      />

      {/* ── Parallax doodles — different scroll speeds (0.1x–0.5x) ──────── */}
      <ParallaxDoodle posStyle={{ top: 320, left: 28 }} speed={0.12} delay={0.3}>
        <PlanetDoodle />
      </ParallaxDoodle>
      <ParallaxDoodle posStyle={{ bottom: 140, left: 60 }} speed={0.35} delay={1.0}>
        <EraserDoodle />
      </ParallaxDoodle>
      <ParallaxDoodle posStyle={{ top: 140, right: 56 }} speed={0.22} delay={0.5}>
        <StarDoodle />
      </ParallaxDoodle>
      <ParallaxDoodle posStyle={{ bottom: 200, right: 32 }} speed={0.48} delay={0.8}>
        <PencilDoodle />
      </ParallaxDoodle>

      {/* ── Center content ──────────────────────────────────────────────── */}
      <div className="relative max-w-6xl mx-auto flex flex-col items-center text-center">
        {/* Eyebrow */}
        <div
          className="hero-eyebrow inline-flex items-center font-manrope font-bold mb-9"
          style={{
            padding: "10px 18px",
            background: TOKEN.white,
            border: `2px solid ${TOKEN.charcoal}`,
            borderRadius: 999,
            fontSize: 13,
            color: TOKEN.charcoal,
          }}
        >
          参考图驱动 · 平台原生感 · 副业友好
        </div>

        {/* Headline — cycling word embedded */}
        <h1
          className="hero-h1-inner font-alfa text-charcoal w-full"
          style={{
            fontSize: "clamp(40px, 7vw, 88px)",
            lineHeight: 1.0,
            letterSpacing: "-0.025em",
            marginBottom: 28,
          }}
        >
          {/* Line 1 */}
          <span className="block">参考图一粘，</span>
          {/* Line 2 */}
          <span className="block mt-2">
            <span className="relative inline-block" style={{ overflow: "visible" }}>
              {/* Yellow pill highlight — stays behind */}
              <span
                ref={pillRef}
                aria-hidden
                className="absolute"
                style={{
                  inset: "-4px -12px",
                  background: TOKEN.lemon,
                  borderRadius: 16,
                  zIndex: 0,
                  transformOrigin: "center",
                }}
              />
              {/* Cycling word */}
              <span
                ref={wordRef}
                className="relative font-alfa"
                style={{ zIndex: 1, display: "inline-block", willChange: "transform" }}
              >
                {displayWord}
              </span>
            </span>
          </span>
          {/* Line 3 */}
          <span className="block mt-2">原生感图文，</span>
          {/* Line 4 */}
          <span className="block mt-2">快人一步。</span>
        </h1>

        {/* Subtitle */}
        <p
          className="hero-sub font-manrope"
          style={{
            fontSize: "clamp(16px, 1.4vw, 19px)",
            lineHeight: 1.6,
            opacity: 0.68,
            maxWidth: 580,
            marginBottom: 36,
            color: TOKEN.charcoal,
          }}
        >
          上传参考图，ima ima queencard 识别爆款版式与平台语感，快速生成成套小红书图文。
        </p>

        {/* CTAs */}
        <div className="hero-cta flex flex-wrap gap-3 justify-center">
          <MagBtn href={DEFAULT_TRY_URL} primary>立即试一版</MagBtn>
          <MagBtn href="#gallery">看生成对比</MagBtn>
        </div>

        {/* Scroll hint */}
        <p
          className="font-manrope font-bold absolute"
          style={{
            bottom: -60,
            fontSize: 12,
            opacity: 0.38,
            color: TOKEN.charcoal,
            letterSpacing: "0.06em",
          }}
        >
          向下滚动探索 ↓
        </p>
      </div>
    </section>
  );
}
