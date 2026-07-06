"use client";

import { useState } from "react";
import { CreditCard, History, NotebookPen, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";

import { RechargeDialog } from "./recharge-dialog";
import {
  RechargeHistoryDrawer,
  type RechargeHistoryTarget,
} from "./recharge-history-drawer";
import { UserNoteDialog } from "./user-note-dialog";

export type RechargeUserRow = {
  userId: string;
  email: string;
  name: string | null;
  status: "active";
  role: "admin" | "user";
  createdAt: string;
  isPaidUser: boolean;
  inviteCode: string | null;
  availableCredits: number;
  frozenCredits: number;
  usedCredits: number;
  totalCredits: number;
  latestRecharge: {
    orderId: number;
    orderNo: string;
    credits: number;
    createdAt: string;
    adminEmail: string | null;
  } | null;
  note: string | null;
};

type RechargeTarget = {
  userId: string;
  email: string;
  credits?: number;
};

type NoteTarget = {
  userId: string;
  email: string;
  note: string | null;
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

function formatNumber(value: number) {
  return value.toLocaleString("zh-CN");
}

export function RechargeUserTable({
  items,
  isSuperAdmin,
}: {
  items: RechargeUserRow[];
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [rechargeTarget, setRechargeTarget] = useState<RechargeTarget | null>(
    null
  );
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [historyTarget, setHistoryTarget] =
    useState<RechargeHistoryTarget | null>(null);
  const [revokingOrderId, setRevokingOrderId] = useState<number | null>(null);

  async function revokeRecharge(row: RechargeUserRow) {
    if (!row.latestRecharge) return;

    const reason = window.prompt(
      `撤回 ${row.email} 的最近人工充值？请输入原因。`
    );
    if (!reason?.trim()) return;

    setRevokingOrderId(row.latestRecharge.orderId);
    try {
      const response = await fetch(
        `/api/admin/recharges/${row.latestRecharge.orderId}/refund`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        throw new Error(body?.error?.message ?? "撤回失败");
      }

      toast.success("撤回完成", {
        description: `已撤回 ${body.data.refundedCredits.toLocaleString(
          "zh-CN"
        )} 积分`,
      });
      router.refresh();
    } catch (error) {
      toast.error("撤回失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setRevokingOrderId(null);
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="min-w-[260px]">用户</TableHead>
              <TableHead className="min-w-[148px]">注册时间</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>付费</TableHead>
              <TableHead className="text-right">可用积分</TableHead>
              <TableHead className="text-right">冻结</TableHead>
              <TableHead className="text-right">已消耗</TableHead>
              <TableHead className="min-w-[160px]">最近充值</TableHead>
              <TableHead className="min-w-[160px]">备注</TableHead>
              <TableHead className="min-w-[260px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="h-32 text-center text-sm font-semibold text-slate-500"
                >
                  暂无匹配用户
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow key={row.userId}>
                  <TableCell>
                    <div className="grid gap-1">
                      <span className="font-bold text-slate-900">
                        {row.email}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">
                        {row.name || row.userId}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-semibold text-slate-700">
                    {formatDate(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.role === "admin" ? "default" : "outline"}>
                      {row.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.isPaidUser ? "secondary" : "outline"}>
                      {row.isPaidUser ? "是" : "否"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-black">
                    {formatNumber(row.availableCredits)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-slate-600">
                    {formatNumber(row.frozenCredits)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-slate-600">
                    {formatNumber(row.usedCredits)}
                  </TableCell>
                  <TableCell>
                    {row.latestRecharge ? (
                      <div className="grid gap-1">
                        <span className="font-bold text-emerald-700">
                          +{formatNumber(row.latestRecharge.credits)}
                        </span>
                        <span className="text-xs text-slate-500">
                          {formatDate(row.latestRecharge.createdAt)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="line-clamp-2 text-sm font-semibold text-slate-600">
                      {row.note || "-"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={() =>
                          setRechargeTarget({
                            userId: row.userId,
                            email: row.email,
                            credits: 100,
                          })
                        }
                      >
                        <CreditCard className="size-4" aria-hidden="true" />
                        +100
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          setRechargeTarget({
                            userId: row.userId,
                            email: row.email,
                            credits: 500,
                          })
                        }
                      >
                        <CreditCard className="size-4" aria-hidden="true" />
                        +500
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setRechargeTarget({
                            userId: row.userId,
                            email: row.email,
                          })
                        }
                      >
                        自定义
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setNoteTarget({
                            userId: row.userId,
                            email: row.email,
                            note: row.note,
                          })
                        }
                      >
                        <NotebookPen className="size-4" aria-hidden="true" />
                        备注
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setHistoryTarget({
                            email: row.email,
                            latestRecharge: row.latestRecharge,
                          })
                        }
                      >
                        <History className="size-4" aria-hidden="true" />
                        明细
                      </Button>
                      {isSuperAdmin && row.latestRecharge ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={revokingOrderId === row.latestRecharge.orderId}
                          onClick={() => revokeRecharge(row)}
                        >
                          <RotateCcw className="size-4" aria-hidden="true" />
                          撤回
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <RechargeDialog
        target={rechargeTarget}
        onOpenChange={setRechargeTarget}
      />
      <UserNoteDialog target={noteTarget} onOpenChange={setNoteTarget} />
      <RechargeHistoryDrawer
        target={historyTarget}
        onOpenChange={setHistoryTarget}
      />
    </>
  );
}
