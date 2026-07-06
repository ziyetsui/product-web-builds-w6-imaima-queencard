import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Scroll-driven reveal hook. Provides classes:
 *  - .anim-title        : clip-path curtain reveal (entrance)
 *  - .anim-fade         : fade-up (entrance)
 *  - .anim-from-left    : slide from left (entrance)
 *  - .anim-from-right   : slide from right (entrance)
 *  - .anim-cards>.anim-card : staggered + scrub scale/fade (entrance + scrub)
 *  - .anim-scrub-card   : scale + opacity scrubbed across the entire scroll lifecycle
 *  - .anim-words > span : word-by-word opacity scrub (must be pre-split)
 */
export function useGsapReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!ref.current) return;
    const root = ref.current;

    const ctx = gsap.context(() => {
      // 1) Title — clip-path curtain reveal
      gsap.utils.toArray<HTMLElement>(".anim-title").forEach((el) => {
        gsap.fromTo(
          el,
          { clipPath: "inset(0 0 100% 0)", y: 14, opacity: 0 },
          {
            clipPath: "inset(0 0 0% 0)",
            y: 0,
            opacity: 1,
            duration: 1.05,
            ease: "power3.out",
            scrollTrigger: { trigger: el, start: "top 88%", toggleActions: "play none none reverse" },
          }
        );
      });

      // 2) Fade-up
      gsap.utils.toArray<HTMLElement>(".anim-fade").forEach((el) => {
        gsap.fromTo(
          el,
          { y: 26, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.85,
            ease: "power2.out",
            scrollTrigger: { trigger: el, start: "top 90%", toggleActions: "play none none reverse" },
          }
        );
      });

      // 3) Slide from left / right
      gsap.utils.toArray<HTMLElement>(".anim-from-left").forEach((el) => {
        gsap.fromTo(
          el,
          { x: -50, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.85,
            ease: "power3.out",
            scrollTrigger: { trigger: el, start: "top 85%", toggleActions: "play none none reverse" },
          }
        );
      });
      gsap.utils.toArray<HTMLElement>(".anim-from-right").forEach((el) => {
        gsap.fromTo(
          el,
          { x: 50, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.85,
            ease: "power3.out",
            scrollTrigger: { trigger: el, start: "top 85%", toggleActions: "play none none reverse" },
          }
        );
      });

      // 4) Card group with stagger entrance
      gsap.utils.toArray<HTMLElement>(".anim-cards").forEach((group) => {
        const cards = group.querySelectorAll<HTMLElement>(".anim-card");
        if (!cards.length) return;
        gsap.fromTo(
          cards,
          { y: 36, opacity: 0, scale: 0.94 },
          {
            y: 0,
            opacity: 1,
            scale: 1,
            duration: 0.7,
            stagger: 0.09,
            ease: "power3.out",
            scrollTrigger: { trigger: group, start: "top 82%", toggleActions: "play none none reverse" },
          }
        );
      });

      // 5) Scrub: image-card scale & fade across entire viewport lifecycle
      //    Mimics lpalo.com's "growing then fading" cinematic feel
      gsap.utils.toArray<HTMLElement>(".anim-scrub-card").forEach((el) => {
        gsap.fromTo(
          el,
          { scale: 0.88, opacity: 0.4 },
          {
            scale: 1,
            opacity: 1,
            ease: "none",
            scrollTrigger: {
              trigger: el,
              start: "top 95%",
              end: "top 40%",
              scrub: 0.6,
            },
          }
        );
        // Fade-out on exit
        gsap.to(el, {
          opacity: 0.45,
          scale: 0.96,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "bottom 55%",
            end: "bottom 10%",
            scrub: 0.6,
          },
        });
      });

      // 6) Word-by-word opacity scrub — element must contain pre-split <span> per word
      gsap.utils.toArray<HTMLElement>(".anim-words").forEach((el) => {
        const words = el.querySelectorAll<HTMLElement>("span");
        if (!words.length) return;
        gsap.fromTo(
          words,
          { opacity: 0.15 },
          {
            opacity: 1,
            ease: "none",
            stagger: 0.08,
            scrollTrigger: {
              trigger: el,
              start: "top 80%",
              end: "top 35%",
              scrub: 0.5,
            },
          }
        );
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return ref;
}
