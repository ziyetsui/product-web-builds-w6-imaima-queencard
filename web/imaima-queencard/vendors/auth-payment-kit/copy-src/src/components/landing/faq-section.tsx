"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { BlurFade } from "@/components/magicui/blur-fade";

interface FAQItem {
  questionKey: string;
  answerKey: string;
}

const faqData: FAQItem[] = [
  {
    questionKey: "general.question",
    answerKey: "general.answer",
  },
  {
    questionKey: "commercial.question",
    answerKey: "commercial.answer",
  },
  {
    questionKey: "aiModels.question",
    answerKey: "aiModels.answer",
  },
  {
    questionKey: "credits.question",
    answerKey: "credits.answer",
  },
  {
    questionKey: "refund.question",
    answerKey: "refund.answer",
  },
  {
    questionKey: "support.question",
    answerKey: "support.answer",
  },
];

export function FAQSection() {
  const t = useTranslations("FAQ");

  // Generate FAQPage JSON-LD for SEO/GEO (+40% AI search visibility)
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqData.map((item) => ({
      "@type": "Question",
      name: t(item.questionKey),
      acceptedAnswer: {
        "@type": "Answer",
        text: t(item.answerKey),
      },
    })),
  };

  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      {/* 全黑背景 */}
      <div className="absolute inset-0 -z-10 bg-black" />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto">
          {/* Title */}
          <BlurFade inView>
            <motion.div className="text-center mb-12">
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-2xl md:text-3xl font-light font-plex-mono text-white mb-4 lowercase tracking-widest"
              >
                {t("title")}
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="text-[11px] font-plex-mono text-white/40 tracking-[0.1em] lowercase max-w-2xl mx-auto"
              >
                {t("subtitle")}
              </motion.p>
            </motion.div>
          </BlurFade>

          {/* FAQ list */}
          <BlurFade delay={0.2} inView>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {faqData.map((item, index) => (
                  <motion.div
                    key={item.questionKey}
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.08 * index }}
                    className="flex flex-col gap-4 p-6 border border-white/10 hover:border-white/30 transition-all duration-200 font-plex-mono h-full"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 border border-white/20 flex items-center justify-center text-white/50 text-[10px] font-light mt-0.5">
                        {index + 1}
                      </span>
                      <h3 className="text-[12px] font-light tracking-[0.1em] text-white/80 lowercase leading-relaxed">
                        {t(item.questionKey)}
                      </h3>
                    </div>
                    <p className="pl-9 text-[11px] font-light tracking-[0.05em] text-white/40 leading-[1.8] lowercase">
                      {t(item.answerKey)}
                    </p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </BlurFade>

          {/* Bottom contact */}
          <BlurFade delay={0.4} inView>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.4 }}
              className="text-center mt-12 p-6 rounded-none border border-white/10 font-plex-mono"
            >
              <p className="text-[11px] text-white/50 lowercase tracking-[0.1em]">
                {t("contact")}
                <a
                  href="mailto:support@goya.ai"
                  className="text-white hover:text-[#008fff] transition-colors ml-2"
                >
                  support@goya.ai
                </a>
              </p>
            </motion.div>
          </BlurFade>
        </div>
      </div>
    </section>
  );
}
