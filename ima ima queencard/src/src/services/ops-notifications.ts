import { eq } from "drizzle-orm";

import { getPricingProduct } from "@/config/pricing-products";
import { db, users } from "@/db";
import { sendTransactionalEmail } from "@/lib/email";
import { env } from "@/lib/auth/env.mjs";

type OpsMessage = Readonly<{
  title: string;
  lines: string[];
}>;

async function sendFeishu(message: OpsMessage) {
  if (!env.FEISHU_OPS_WEBHOOK_URL) return false;

  const response = await fetch(env.FEISHU_OPS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msg_type: "interactive",
      card: {
        header: {
          template: "blue",
          title: { tag: "plain_text", content: message.title },
        },
        elements: [
          { tag: "markdown", content: message.lines.join("\n") },
        ],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Feishu webhook failed with HTTP ${response.status}`);
  }
  const body = (await response.json().catch(() => null)) as {
    code?: number;
    StatusCode?: number;
    msg?: string;
    StatusMessage?: string;
  } | null;
  const code = body?.code ?? body?.StatusCode ?? 0;
  if (code !== 0) {
    throw new Error(body?.msg ?? body?.StatusMessage ?? `Feishu webhook failed: ${code}`);
  }
  return true;
}

async function sendEmailFallback(message: OpsMessage) {
  const recipient = env.OPS_ALERT_EMAIL || env.ADMIN_EMAIL;
  if (!recipient || (!env.ZEABUR_EMAIL_API_KEY && !env.RESEND_API_KEY)) {
    return false;
  }
  const result = await sendTransactionalEmail({
    to: recipient,
    subject: message.title,
    text: message.lines.join("\n"),
    html: `<h2>${escapeHtml(message.title)}</h2>${message.lines
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join("")}`,
  });
  if (result.error) throw new Error(result.error.message ?? "Email delivery failed");
  return true;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

async function deliver(message: OpsMessage) {
  try {
    if (await sendFeishu(message)) return;
  } catch (error) {
    console.error("[Ops] Feishu notification failed:", error);
  }

  try {
    if (await sendEmailFallback(message)) return;
    console.warn("[Ops] Notification skipped: no Feishu webhook or email provider configured.");
  } catch (error) {
    console.error("[Ops] Email fallback failed:", error);
  }
}

export async function notifyNewRegistration(user: {
  id: string;
  email?: string | null;
  name?: string | null;
  createdAt?: Date;
}) {
  await deliver({
    title: "👤 新用户注册",
    lines: [
      `**用户：** ${user.email || "未提供邮箱"}`,
      `**名称：** ${user.name || "未填写"}`,
      `**用户 ID：** ${user.id}`,
      `**时间：** ${(user.createdAt ?? new Date()).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
    ],
  });
}

export async function notifyPaymentFulfilled(params: {
  userId: string;
  productKey: string;
  provider?: string | null;
  credits: number;
  orderNo: string;
}) {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1);
  const product = getPricingProduct(params.productKey);
  const listedPrice = product ? `¥${product.priceCny.toLocaleString("zh-CN")}` : "未知";

  await deliver({
    title: "💰 新付款成功",
    lines: [
      `**用户：** ${user?.email ?? params.userId}`,
      `**商品：** ${product?.title ?? params.productKey}`,
      `**人民币标价：** ${listedPrice}`,
      `**到账：** ${params.credits.toLocaleString("zh-CN")} 积分`,
      `**渠道：** ${(params.provider ?? "unknown").toUpperCase()}`,
      "**状态：** 积分已到账",
      `**订单号：** ${params.orderNo}`,
      "_渠道实际扣款币种与金额请以支付平台订单为准。_",
    ],
  });
}
