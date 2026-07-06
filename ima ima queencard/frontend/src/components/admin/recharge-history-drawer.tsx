"use client";

import { FileClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type RechargeHistoryTarget = {
  email: string;
  latestRecharge: {
    orderId: number;
    orderNo: string;
    credits: number;
    createdAt: string;
    adminEmail: string | null;
  } | null;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RechargeHistoryDrawer({
  target,
  onOpenChange,
}: {
  target: RechargeHistoryTarget | null;
  onOpenChange: (target: RechargeHistoryTarget | null) => void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onOpenChange(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileClock className="size-5" aria-hidden="true" />
            充值明细
          </DialogTitle>
          <DialogDescription>{target?.email}</DialogDescription>
        </DialogHeader>

        {target?.latestRecharge ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
            <dl className="grid gap-3">
              <div className="grid grid-cols-[96px_1fr] gap-3">
                <dt className="font-bold text-slate-500">订单号</dt>
                <dd className="font-semibold text-slate-900">
                  {target.latestRecharge.orderNo}
                </dd>
              </div>
              <div className="grid grid-cols-[96px_1fr] gap-3">
                <dt className="font-bold text-slate-500">积分</dt>
                <dd className="font-semibold text-slate-900">
                  +{target.latestRecharge.credits.toLocaleString("zh-CN")}
                </dd>
              </div>
              <div className="grid grid-cols-[96px_1fr] gap-3">
                <dt className="font-bold text-slate-500">操作人</dt>
                <dd className="font-semibold text-slate-900">
                  {target.latestRecharge.adminEmail ?? "-"}
                </dd>
              </div>
              <div className="grid grid-cols-[96px_1fr] gap-3">
                <dt className="font-bold text-slate-500">时间</dt>
                <dd className="font-semibold text-slate-900">
                  {formatDate(target.latestRecharge.createdAt)}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm font-semibold text-slate-500">
            暂无人工充值记录。
          </p>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(null)}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
