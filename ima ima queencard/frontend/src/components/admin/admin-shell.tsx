import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AdminSidebar } from "./admin-sidebar";

export function AdminShell({
  active,
  children,
}: {
  active: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto max-w-7xl">
        <section className="mb-8 rounded-lg border border-slate-200 bg-white p-6 md:p-8">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            返回
          </Link>
          <h1 className="text-3xl font-black tracking-tight">管理后台</h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            在不影响现有系统稳定性的前提下，处理用户充值、备注、审计和人工履约。
          </p>
          <p className="mt-3 text-xs font-bold text-slate-500">
            当前角色：admin。superadmin 可执行撤回等高风险操作。
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <AdminSidebar active={active} />
          {children}
        </div>
      </div>
    </main>
  );
}
