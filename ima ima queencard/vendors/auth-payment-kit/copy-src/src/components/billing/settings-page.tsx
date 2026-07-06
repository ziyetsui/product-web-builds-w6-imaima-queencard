"use client";

// ============================================
// Settings Page (Billing Only)
// ============================================

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Mail, IdCard, Calendar } from "lucide-react";
import { useBilling } from "@/hooks/use-billing";
import { AvatarFallback } from "@/components/user/avatar-fallback";
import { BillingList } from "@/components/billing";
import { formatDistanceToNow } from "date-fns";

interface SettingsPageProps {
  locale: string;
  userEmail?: string;
  userId?: string;
}

export function SettingsPage({ locale, userEmail, userId }: SettingsPageProps) {
  const t = useTranslations("dashboard.settings");

  const {
    user,
    invoices,
    hasMore,
    fetchNextPage,
    isLoading,
  } = useBilling();

  // Infinite scroll observer
  const observerTarget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          fetchNextPage();
        }
      },
      { threshold: 1.0 }
    );

    const current = observerTarget.current;
    if (current) {
      observer.observe(current);
    }

    return () => {
      if (current) {
        observer.unobserve(current);
      }
    };
  }, [hasMore, isLoading, fetchNextPage]);

  // Use data from hook if available, otherwise use props
  const displayEmail = user?.email || userEmail;
  const displayUserId = user?.id || userId;
  const joinedDate = user?.createdAt ? new Date(user.createdAt) : null;

  return (
    <div className="space-y-8 font-plex-mono">
      {/* Header */}
      <div className="border-b border-white/8 pb-6">
        <h1 className="text-[22px] font-light text-white/80 lowercase tracking-tight">{t("title")}</h1>
      </div>

      {/* Account Info */}
      <div className="border border-white/8 bg-white/[0.02] p-6">
        <div className="flex items-start gap-6">
          <AvatarFallback
            name={displayEmail}
            email={displayEmail}
            className="h-14 w-14 text-lg"
          />
          <div className="flex-1 space-y-4">
            <div className="text-[9px] text-white/25 uppercase tracking-[0.22em]">{t("account")}</div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Mail className="h-3.5 w-3.5 text-white/20" />
                <span className="text-[10px] text-white/30 tracking-[0.08em] lowercase">{t("email")}:</span>
                <span className="text-[11px] text-white/60 tracking-[0.04em]">{displayEmail}</span>
              </div>
              {displayUserId && (
                <div className="flex items-center gap-3">
                  <IdCard className="h-3.5 w-3.5 text-white/20" />
                  <span className="text-[10px] text-white/30 tracking-[0.08em] lowercase">{t("userId")}:</span>
                  <span className="text-[11px] text-white/40 font-plex-mono tracking-[0.04em]">{displayUserId}</span>
                </div>
              )}
              {joinedDate && (
                <div className="flex items-center gap-3">
                  <Calendar className="h-3.5 w-3.5 text-white/20" />
                  <span className="text-[10px] text-white/30 tracking-[0.08em] lowercase">{t("joined")}:</span>
                  <span className="text-[11px] text-white/40 tracking-[0.04em]">
                    {formatDistanceToNow(joinedDate, { addSuffix: true })}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Billing History */}
      <BillingList
        invoices={invoices}
        hasMore={hasMore}
        onLoadMore={() => fetchNextPage()}
      />

      {hasMore && <div ref={observerTarget} className="py-4" />}
    </div>
  );
}
