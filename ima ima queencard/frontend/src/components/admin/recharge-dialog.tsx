"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, WalletCards } from "lucide-react";
import { useRouter } from "next/navigation";

import { ADMIN_RECHARGE_PAYMENT_CHANNEL_LABELS } from "@/config/admin-recharge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";

type RechargeTarget = {
  userId: string;
  email: string;
  credits?: number;
};

export function RechargeDialog({
  target,
  onOpenChange,
}: {
  target: RechargeTarget | null;
  onOpenChange: (target: RechargeTarget | null) => void;
}) {
  const router = useRouter();
  const [credits, setCredits] = useState("500");
  const [amountYuan, setAmountYuan] = useState("");
  const [paymentChannel, setPaymentChannel] = useState("wechat");
  const [externalPaymentNo, setExternalPaymentNo] = useState("");
  const [remark, setRemark] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const idempotencyKey = useMemo(() => {
    if (!target) return "";
    return crypto.randomUUID();
  }, [target]);

  useEffect(() => {
    if (!target) return;
    setCredits(String(target.credits ?? 500));
    setRemark(`人工充值 ${target.credits ?? 500} 积分`);
    setAmountYuan("");
    setPaymentChannel("wechat");
    setExternalPaymentNo("");
  }, [target]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;

    setIsSubmitting(true);
    try {
      const amountNumber = Number(amountYuan);
      const response = await fetch("/api/admin/recharges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: target.userId,
          credits: Number(credits),
          amountCents:
            amountYuan.trim() && Number.isFinite(amountNumber)
              ? Math.round(amountNumber * 100)
              : undefined,
          currency: "CNY",
          paymentChannel,
          externalPaymentNo,
          remark,
          idempotencyKey,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        throw new Error(body?.error?.message ?? "充值失败");
      }

      toast.success("充值成功", {
        description: `${target.email} 已增加 ${Number(credits).toLocaleString(
          "zh-CN"
        )} 积分`,
      });
      onOpenChange(null);
      router.refresh();
    } catch (error) {
      toast.error("充值失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onOpenChange(null)}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WalletCards className="size-5" aria-hidden="true" />
            人工充值
          </DialogTitle>
          <DialogDescription>
            确认用户付款后再提交。充值会立即进入用户积分余额。
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="rounded-md bg-slate-50 p-3 text-sm font-semibold text-slate-700">
            <p>{target?.email}</p>
            <p className="mt-1 text-xs text-slate-500">{target?.userId}</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="credits">充值积分</Label>
            <Input
              id="credits"
              inputMode="numeric"
              min={1}
              max={10000}
              value={credits}
              onChange={(event) => setCredits(event.target.value)}
              required
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="amount">付款金额（元）</Label>
              <Input
                id="amount"
                inputMode="decimal"
                placeholder="可选"
                value={amountYuan}
                onChange={(event) => setAmountYuan(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>付款渠道</Label>
              <Select value={paymentChannel} onValueChange={setPaymentChannel}>
                <SelectTrigger>
                  <SelectValue placeholder="选择渠道" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ADMIN_RECHARGE_PAYMENT_CHANNEL_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="externalPaymentNo">外部付款凭证</Label>
            <Input
              id="externalPaymentNo"
              placeholder="微信/支付宝/转账单号，可选但建议填写"
              value={externalPaymentNo}
              onChange={(event) => setExternalPaymentNo(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="remark">备注</Label>
            <Textarea
              id="remark"
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(null)}
              disabled={isSubmitting}
            >
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              确认充值
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
