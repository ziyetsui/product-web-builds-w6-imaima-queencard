import { AlertTriangle, CircleDollarSign, UserPlus, UsersRound, Zap } from "lucide-react";

import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdmin } from "@/lib/auth/admin";
import { getOperationsOverview } from "@/services/admin-operations";

export const dynamic = "force-dynamic";

function Metric({ label, value, icon: Icon }: {
  label: string;
  value: string;
  icon: typeof UserPlus;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <Icon className="mb-4 size-5 text-sky-600" aria-hidden="true" />
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black text-slate-900">{value}</p>
    </div>
  );
}

export default async function OperationsPage() {
  await requireAdmin();
  const data = await getOperationsOverview();

  return (
    <AdminShell active="/admin/operations">
      <div className="min-w-0 space-y-6">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="今日新增用户" value={String(data.summary.newUsers)} icon={UserPlus} />
          <Metric label="今日付款人数" value={String(data.summary.payingUsers)} icon={UsersRound} />
          <Metric label="今日收入（人民币标价估算）" value={`¥${data.summary.estimatedRevenueCny.toLocaleString("zh-CN")}`} icon={CircleDollarSign} />
          <Metric label="支付成功但未入账/异常" value={String(data.summary.failedFulfillments)} icon={AlertTriangle} />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <Zap className={data.gptproto.status === "configured" ? "size-5 text-emerald-600" : "size-5 text-red-600"} />
            <div>
              <h2 className="text-lg font-black">GPTProto 服务状态</h2>
              <p className="text-sm font-semibold text-slate-600">{data.gptproto.label}</p>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-xl font-black">最近付款记录</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">金额为商品人民币标价；实际结算以支付渠道订单为准。</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>{["时间", "用户", "商品", "标价", "积分", "渠道"].map((label) => <th key={label} className="px-5 py-3 font-black">{label}</th>)}</tr>
              </thead>
              <tbody>
                {data.recentPayments.map((payment) => (
                  <tr key={payment.id} className="border-t border-slate-100">
                    <td className="px-5 py-4 font-semibold text-slate-600">{payment.fulfilledAt?.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) ?? "-"}</td>
                    <td className="px-5 py-4 font-bold">{payment.email ?? "未知用户"}</td>
                    <td className="px-5 py-4">{payment.productTitle}</td>
                    <td className="px-5 py-4">{payment.listedPriceCny === null ? "-" : `¥${payment.listedPriceCny.toLocaleString("zh-CN")}`}</td>
                    <td className="px-5 py-4">{payment.credits.toLocaleString("zh-CN")}</td>
                    <td className="px-5 py-4 uppercase">{payment.provider}</td>
                  </tr>
                ))}
                {data.recentPayments.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center font-semibold text-slate-500">暂无付款记录</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

