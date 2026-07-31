"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X, Menu } from "lucide-react";
import { Wordmark } from "@/components/layout/Wordmark";
import { authClient } from "@/lib/auth/client";

const navLinks = [
  { label: "复刻爆款", href: "/prompts" },
  { label: "订阅", href: "/pricing" },
];

const signedInLinks = [
  { label: "历史", href: "/generated" },
  { label: "额度", href: "/credits" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user;

  const isActive = (href: string) => pathname === href;
  const buttonClass =
    "px-[18px] py-2.5 rounded-pill border-2 border-charcoal font-manrope text-[14px] font-bold shadow-brand-sm transition-all duration-200 hover:-translate-y-[2px] active:translate-y-0 bg-surface-white text-charcoal hover:bg-lemon";
  const activeClass =
    "px-[18px] py-2.5 rounded-pill border-2 border-charcoal font-manrope text-[14px] font-bold shadow-brand-sm transition-all duration-200 hover:-translate-y-[2px] active:translate-y-0 bg-pumpkin text-charcoal";

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await authClient.signOut();
      setOpen(false);
      router.push("/");
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <>
      <nav className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-[18px] md:px-10">
        {/* Brand */}
        <Link href="/" className="flex items-center transition-transform duration-200 hover:-translate-y-[1px]">
          <Wordmark className="text-charcoal text-[21px] md:text-[24px]" />
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-2.5">
          {navLinks.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className={isActive(l.href) ? activeClass : buttonClass}
            >
              {l.label}
            </Link>
          ))}
          {user ? (
            <>
              {signedInLinks.map((l) => (
                <Link key={l.label} href={l.href} className={isActive(l.href) ? activeClass : buttonClass}>
                  {l.label}
                </Link>
              ))}
              <button type="button" onClick={handleSignOut} disabled={isSigningOut} className={buttonClass}>
                {isSigningOut ? "退出中" : "退出"}
              </button>
            </>
          ) : (
            <Link href="/login" className={isActive("/login") ? activeClass : buttonClass}>
              {isPending ? "..." : "登录"}
            </Link>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          onClick={() => setOpen(true)}
          className="md:hidden w-11 h-11 rounded-full border-2 border-charcoal bg-pumpkin flex items-center justify-center shadow-brand-sm transition-transform hover:scale-105"
          aria-label="打开菜单"
        >
          <Menu size={18} color="#000" strokeWidth={2.5} />
        </button>
      </nav>

      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-charcoal">
          <div className="flex items-center justify-between px-6 py-[18px]">
            <Wordmark className="text-surface-white text-[21px]" qClassName="text-lemon" />
            <button
              onClick={() => setOpen(false)}
              className="w-11 h-11 rounded-full border-2 border-surface-white bg-surface-white flex items-center justify-center"
            >
              <X size={18} color="#000" strokeWidth={2.5} />
            </button>
          </div>
          <div className="flex-1 flex flex-col justify-center px-10 gap-5">
            {navLinks.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`text-left font-alfa text-4xl transition-colors ${
                  isActive(item.href) ? "text-lemon" : "text-surface-white hover:text-lemon"
                }`}
              >
                {item.label}
              </Link>
            ))}
            {user ? (
              <>
                {signedInLinks.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`text-left font-alfa text-4xl transition-colors ${
                      isActive(item.href) ? "text-lemon" : "text-surface-white hover:text-lemon"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="text-left font-alfa text-4xl text-surface-white transition-colors hover:text-lemon"
                >
                  {isSigningOut ? "退出中" : "退出"}
                </button>
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className={`text-left font-alfa text-4xl transition-colors ${
                  isActive("/login") ? "text-lemon" : "text-surface-white hover:text-lemon"
                }`}
              >
                {isPending ? "..." : "登录"}
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
