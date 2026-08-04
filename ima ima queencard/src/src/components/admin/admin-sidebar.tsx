import Link from "next/link";
import {
  BarChart3,
  Activity,
  FileClock,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Tags,
  UsersRound,
  WalletCards,
} from "lucide-react";

import { cn } from "@/lib/utils";

const items = [
  { href: "/admin/operations", label: "运营概览", icon: Activity },
  { href: "/admin/recharges", label: "用户充值管理", icon: WalletCards },
  { href: "/admin/invites", label: "邀请码管理", icon: KeyRound },
  { href: "/admin/risk", label: "风控配置", icon: ShieldCheck },
  { href: "/admin/reports", label: "任务统计报表", icon: BarChart3 },
  { href: "/admin/tasks", label: "用户任务明细", icon: UsersRound },
  { href: "/admin/logs", label: "后台日志查看", icon: FileClock },
  { href: "/admin/templates", label: "模板场景分类", icon: Tags },
  { href: "/admin/image-models", label: "图像技能添加", icon: Sparkles },
];

export function AdminSidebar({ active }: { active: string }) {
  return (
    <aside className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm font-bold text-slate-500">管理菜单</p>
      <nav className="grid gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-bold transition-colors",
                isActive
                  ? "bg-sky-600 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
