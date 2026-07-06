"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/layout/Wordmark";

export default function Footer() {
  const pathname = usePathname();
  const navLinkClass = (href: string) =>
    `hover:underline transition-opacity ${pathname === href ? "opacity-100" : "opacity-60 hover:opacity-100"}`;

  return (
    <footer className="bg-charcoal border-t-2 border-charcoal px-4 md:px-10 py-12">
      <div className="max-w-[1080px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <Link href="/" className="flex items-center transition-transform duration-200 hover:-translate-y-[1px]">
          <div>
            <Wordmark className="text-surface-white text-[19px] block" qClassName="text-lemon" />
            <span className="font-manrope text-[13px] font-medium text-surface-white/55">爆款图驱动的图文生成工具</span>
          </div>
        </Link>
        <div className="flex flex-wrap gap-5 font-manrope text-[14px] font-medium text-surface-white">
          <Link href="/" className={navLinkClass("/")}>
            首页
          </Link>
          <Link href="/prompts" className={navLinkClass("/prompts")}>
            复刻爆款
          </Link>
        </div>
      </div>
    </footer>
  );
}
