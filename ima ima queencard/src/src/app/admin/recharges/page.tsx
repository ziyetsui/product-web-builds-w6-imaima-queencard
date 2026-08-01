import Link from "next/link";
import { Filter, Search } from "lucide-react";

import { AdminShell } from "@/components/admin/admin-shell";
import {
  RechargeUserTable,
  type RechargeUserRow,
} from "@/components/admin/recharge-user-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isSuperAdminEmail, requireAdmin } from "@/lib/auth/admin";
import { listAdminRechargeUsers } from "@/services/admin-recharge";

type SearchParamsValue = string | string[] | undefined;
type AdminRechargePageProps = {
  searchParams?:
    | Promise<Record<string, SearchParamsValue>>
    | Record<string, SearchParamsValue>;
};

function getSearchParam(
  searchParams: Record<string, SearchParamsValue>,
  key: string
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function getNumberParam(
  searchParams: Record<string, SearchParamsValue>,
  key: string
) {
  const value = getSearchParam(searchParams, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function serializeRow(row: Awaited<ReturnType<typeof listAdminRechargeUsers>>["items"][number]): RechargeUserRow {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    latestRecharge: row.latestRecharge
      ? {
          ...row.latestRecharge,
          createdAt: row.latestRecharge.createdAt.toISOString(),
        }
      : null,
  };
}

function buildPageHref(params: URLSearchParams, page: number) {
  const next = new URLSearchParams(params);
  next.set("page", String(page));
  return `/admin/recharges?${next.toString()}`;
}

export default async function AdminRechargesPage({
  searchParams,
}: AdminRechargePageProps = {}) {
  const adminUser = await requireAdmin("/login?from=/admin/recharges");
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const q = getSearchParam(resolvedSearchParams, "q") ?? "";
  const rechargeStatus =
    (getSearchParam(resolvedSearchParams, "rechargeStatus") as
      | "all"
      | "recharged"
      | "never_recharged"
      | undefined) ?? "all";
  const page = getNumberParam(resolvedSearchParams, "page") ?? 1;
  const pageSize = getNumberParam(resolvedSearchParams, "pageSize") ?? 50;
  const data = await listAdminRechargeUsers({
    q,
    rechargeStatus,
    page,
    pageSize,
  });
  const serializedItems = data.items.map(serializeRow);
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (rechargeStatus && rechargeStatus !== "all") {
    params.set("rechargeStatus", rechargeStatus);
  }
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <AdminShell active="/admin/recharges">
      <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap gap-4 text-sm font-bold text-slate-600">
              <span>用户总数：{data.summary.totalUsers.toLocaleString("zh-CN")}</span>
              <span>当前页用户：{data.summary.currentPageUsers}</span>
              <span>
                当前页积分：
                {data.summary.currentPageAvailableCredits.toLocaleString("zh-CN")}
              </span>
              <span>
                今日人工充值：
                {data.summary.todayManualRechargeCredits.toLocaleString("zh-CN")}
              </span>
            </div>
            <h2 className="mt-6 text-2xl font-black">用户充值管理</h2>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              用户注册后会出现在这里。核对线下付款后，可给用户人工加积分。
            </p>
          </div>

          <form
            action="/admin/recharges"
            className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_180px_auto]"
          >
            <label className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <Input
                name="q"
                defaultValue={q}
                className="pl-9"
                placeholder="搜索邮箱/用户名/用户 ID/付款凭证"
              />
            </label>
            <label className="relative">
              <Filter
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <select
                name="rechargeStatus"
                defaultValue={rechargeStatus}
                className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm font-semibold text-slate-700"
              >
                <option value="all">全部用户</option>
                <option value="recharged">已人工充值</option>
                <option value="never_recharged">未人工充值</option>
              </select>
            </label>
            <Button type="submit">查询</Button>
          </form>
        </div>

        <RechargeUserTable
          items={serializedItems}
          isSuperAdmin={isSuperAdminEmail(adminUser.email)}
        />

        <div className="mt-5 flex flex-col gap-3 text-sm font-semibold text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>
            第 {data.page} / {totalPages} 页，共{" "}
            {data.total.toLocaleString("zh-CN")} 个用户
          </span>
          <div className="flex gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              disabled={data.page <= 1}
            >
              <Link href={buildPageHref(params, Math.max(1, data.page - 1))}>
                上一页
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              disabled={data.page >= totalPages}
            >
              <Link
                href={buildPageHref(params, Math.min(totalPages, data.page + 1))}
              >
                下一页
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </AdminShell>
  );
}
