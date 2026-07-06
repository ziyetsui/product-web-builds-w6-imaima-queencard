import Link from "next/link";
import { Wordmark } from "@/components/layout/Wordmark";

import { requireAuth } from "@/lib/auth";
import { creditService } from "@/services/credit";

export const dynamic = "force-dynamic";

type CreditHistoryRecord = Awaited<
  ReturnType<typeof creditService.getHistory>
>["records"][number];

const creditTypeLabels: Record<string, string> = {
  NEW_USER: "新用户欢迎积分",
  ORDER_PAY: "积分包到账",
  SUBSCRIPTION: "会员周期积分",
  VIDEO_CONSUME: "图片生成消耗",
  REFUND: "退款或失败返还",
  EXPIRED: "积分过期",
  SYSTEM_ADJUST: "系统调整",
};

const englishRemarkLabels: Record<string, string> = {
  "New user welcome credits": "新用户欢迎积分",
  "Stripe subscription credits": "会员周期积分到账",
  "Stripe credit pack": "积分包到账",
  "Creem subscription credits": "会员周期积分到账",
  "Creem credit pack": "积分包到账",
};

function formatCredits(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("zh-CN")} 积分`;
}

function getCreditRecordTitle(record: CreditHistoryRecord) {
  const remark = record.remark?.trim();
  if (remark && /[\u4e00-\u9fff]/.test(remark)) return remark;
  if (remark?.startsWith("Creem subscription credits")) {
    return "会员周期积分到账";
  }
  if (remark?.startsWith("Creem credit pack")) return "积分包到账";
  if (remark && englishRemarkLabels[remark]) return englishRemarkLabels[remark];
  return creditTypeLabels[record.transType] ?? "积分变动";
}

export default async function CreditsPage() {
  const user = await requireAuth("/login?from=/credits");
  const balance = await creditService.getBalance(user.id);
  const history = await creditService.getHistory(user.id, { limit: 10 });

  return (
    <main className="min-h-screen bg-canvas-pink px-6 py-8 text-charcoal">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-10 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center transition-transform duration-200 hover:-translate-y-[1px]">
            <Wordmark className="text-charcoal text-[20px]" />
          </Link>
          <Link
            href="/pricing"
            className="rounded-full border-2 border-charcoal bg-surface-white px-5 py-2 text-sm font-black shadow-[3px_3px_0_#000]"
          >
            购买积分
          </Link>
        </nav>

        <section className="mb-6 rounded-[18px] border-2 border-charcoal bg-surface-white p-6 shadow-[8px_8px_0_#000]">
          <p className="mb-3 inline-flex rounded-full border-2 border-charcoal bg-seafoam px-4 py-1 text-xs font-black">
            积分
          </p>
          <h1 className="font-alfa text-4xl">我的积分账户</h1>
          <p className="mt-2 text-sm font-bold text-charcoal/70">
            当前账号：{user.email}
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {[
              ["可用积分", balance.availableCredits],
              ["总积分", balance.totalCredits],
              ["已使用", balance.usedCredits],
              ["冻结积分", balance.frozenCredits],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-[14px] border-2 border-charcoal bg-lemon p-4 shadow-[4px_4px_0_#000]"
              >
                <p className="text-xs font-black text-charcoal/65">{label}</p>
                <p className="mt-2 font-alfa text-3xl">
                  {Number(value).toLocaleString("zh-CN")}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[18px] border-2 border-charcoal bg-surface-white p-6 shadow-[8px_8px_0_#000]">
          <h2 className="font-alfa text-2xl">最近记录</h2>
          <div className="mt-5 grid gap-3">
            {history.records.length === 0 ? (
              <p className="text-sm font-bold text-charcoal/60">
                暂无积分记录。注册或购买后会显示在这里。
              </p>
            ) : (
              history.records.map((record) => (
                <div
                  key={record.id}
                  className="grid gap-2 rounded-[12px] border-2 border-charcoal bg-canvas-pink p-4 text-sm font-bold md:grid-cols-[1fr_auto_auto]"
                >
                  <span>{getCreditRecordTitle(record)}</span>
                  <span>{formatCredits(record.credits)}</span>
                  <span>余额 {record.balanceAfter.toLocaleString("zh-CN")} 积分</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
