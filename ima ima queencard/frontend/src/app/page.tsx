"use client";

import { useEffect } from "react";
import Navbar from "@/components/layout/Navbar";
import HeroSection from "@/components/landing/HeroSection";
import ContrastSection from "@/components/landing/ContrastSection";
import ProcessSection from "@/components/landing/ProcessSection";
import MarqueeBand from "@/components/landing/MarqueeBand";
import GallerySection from "@/components/landing/GallerySection";
import UseCases from "@/components/landing/UseCases";
import FinalCta from "@/components/landing/FinalCta";
import Footer from "@/components/layout/Footer";

export default function Index() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <main className="min-h-screen bg-canvas-pink font-manrope overflow-x-hidden w-full max-w-full">
      <div className="relative">
        <Navbar />
        <HeroSection />
      </div>
      <ContrastSection />
      <ProcessSection />
      <MarqueeBand />
      <GallerySection />
      <UseCases />
      <FinalCta />
      <Footer />
    </main>
  );
}
