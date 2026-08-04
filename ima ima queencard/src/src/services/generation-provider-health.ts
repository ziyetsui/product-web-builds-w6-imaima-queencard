import { eq } from "drizzle-orm";

import { db, generationProviderHealth } from "@/db";
import { ApiError } from "@/lib/api/error";
import { env as authEnv } from "@/lib/auth/env.mjs";
import { sendTransactionalEmail } from "@/lib/email";
import { isGptProtoInsufficientBalanceError } from "@/services/gptproto";

const PROVIDER = "gptproto";
const CIRCUIT_OPEN_MS = 15 * 60 * 1_000;
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
export const GENERATION_MAINTENANCE_MESSAGE =
  "图片生成服务正在补充额度，请稍后再试。此次请求未扣除积分。";

async function currentHealth() {
  const [health] = await db
    .select()
    .from(generationProviderHealth)
    .where(eq(generationProviderHealth.provider, PROVIDER))
    .limit(1);
  return health ?? null;
}

async function sendAlert(subject: string, text: string) {
  try {
    const result = await sendTransactionalEmail({
      to: authEnv.ADMIN_EMAIL,
      subject,
      text,
    });
    if (result.error) {
      console.error("Failed to send GPTProto provider alert:", result.error);
    }
  } catch (error) {
    console.error("Failed to send GPTProto provider alert:", error);
  }
}

function shouldAlert(lastAlertAt: Date | null | undefined, now: Date) {
  return !lastAlertAt || now.getTime() - lastAlertAt.getTime() >= ALERT_COOLDOWN_MS;
}

export async function assertGenerationProviderAvailable(now = new Date()) {
  const health = await currentHealth();
  if (
    health?.status === "unavailable" &&
    (!health.unavailableUntil || health.unavailableUntil > now)
  ) {
    throw new ApiError(GENERATION_MAINTENANCE_MESSAGE, 503, {
      code: health.errorCode ?? "GENERATION_PROVIDER_UNAVAILABLE",
      retryAfterSeconds: health.unavailableUntil
        ? Math.max(1, Math.ceil((health.unavailableUntil.getTime() - now.getTime()) / 1_000))
        : 900,
    });
  }
}

export async function recordGenerationProviderFailure(
  error: unknown,
  options: { degraded?: boolean; errorCode?: string } = {}
) {
  const now = new Date();
  const previous = await currentHealth();
  const insufficient =
    options.errorCode === "GPTPROTO_INSUFFICIENT_BALANCE" ||
    isGptProtoInsufficientBalanceError(error);
  const status = options.degraded ? "degraded" : "unavailable";
  const errorCode = insufficient
    ? "GPTPROTO_INSUFFICIENT_BALANCE"
    : options.errorCode ?? (options.degraded
      ? "GPTPROTO_PRIMARY_UNAVAILABLE"
      : "GENERATION_PROVIDER_UNAVAILABLE");
  const reason = insufficient
    ? "GPTProto balance is insufficient"
    : error instanceof Error
      ? error.message.slice(0, 1_000)
      : "GPTProto is unavailable";
  const alert = shouldAlert(previous?.lastAlertAt, now);

  await db
    .insert(generationProviderHealth)
    .values({
      provider: PROVIDER,
      status,
      reason,
      errorCode,
      unavailableUntil: options.degraded
        ? null
        : new Date(now.getTime() + CIRCUIT_OPEN_MS),
      lastErrorAt: now,
      lastAlertAt: alert ? now : previous?.lastAlertAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: generationProviderHealth.provider,
      set: {
        status,
        reason,
        errorCode,
        unavailableUntil: options.degraded
          ? null
          : new Date(now.getTime() + CIRCUIT_OPEN_MS),
        lastErrorAt: now,
        lastAlertAt: alert ? now : previous?.lastAlertAt,
        updatedAt: now,
      },
    });

  if (alert) {
    await sendAlert(
      insufficient
        ? "[ima ima] GPTProto 余额不足"
        : "[ima ima] 图片生成供应商异常",
      `${reason}\n\n当前状态：${status}\n站点已${
        options.degraded ? "切换备用 API" : "临时停止接收新的生成任务"
      }。请检查 GPTProto 余额和 API 可用性。`
    );
  }
}

export async function recordGenerationProviderSuccess(
  route: "primary" | "fallback"
) {
  if (route === "fallback") return;
  const now = new Date();
  await db
    .insert(generationProviderHealth)
    .values({
      provider: PROVIDER,
      status: "available",
      reason: null,
      errorCode: null,
      unavailableUntil: null,
      lastSuccessAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: generationProviderHealth.provider,
      set: {
        status: "available",
        reason: null,
        errorCode: null,
        unavailableUntil: null,
        lastSuccessAt: now,
        updatedAt: now,
      },
    });
}

function balanceCnyFromResponse(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const body = value as {
    balanceCny?: unknown;
    balance_cny?: unknown;
    data?: { balanceCny?: unknown; balance_cny?: unknown };
  };
  const raw =
    body.balanceCny ??
    body.balance_cny ??
    body.data?.balanceCny ??
    body.data?.balance_cny;
  const balance = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(balance) && balance >= 0 ? balance : null;
}

export async function checkGptProtoBalance() {
  const url = process.env.GPTPROTO_BALANCE_API_URL?.trim();
  const apiKey = process.env.GPTPROTO_API_KEY?.trim();
  if (!url || !apiKey) return { checked: false as const };

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`GPTProto balance check failed with HTTP ${response.status}`);
  }
  const balanceCny = balanceCnyFromResponse(await response.json());
  if (balanceCny === null) {
    throw new Error("GPTProto balance response does not contain balanceCny");
  }

  const threshold = Number(process.env.GPTPROTO_LOW_BALANCE_CNY ?? 500);
  const now = new Date();
  const previous = await currentHealth();
  const low = balanceCny < threshold;
  const alert = low && shouldAlert(previous?.lastAlertAt, now);
  await db
    .insert(generationProviderHealth)
    .values({
      provider: PROVIDER,
      status: balanceCny <= 0 ? "unavailable" : low ? "degraded" : "available",
      reason: low ? `GPTProto balance is below CNY ${threshold}` : null,
      errorCode: low ? "GPTPROTO_LOW_BALANCE" : null,
      balanceCny: Math.round(balanceCny),
      unavailableUntil: balanceCny <= 0 ? new Date(now.getTime() + CIRCUIT_OPEN_MS) : null,
      lastAlertAt: alert ? now : previous?.lastAlertAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: generationProviderHealth.provider,
      set: {
        status: balanceCny <= 0 ? "unavailable" : low ? "degraded" : "available",
        reason: low ? `GPTProto balance is below CNY ${threshold}` : null,
        errorCode: low ? "GPTPROTO_LOW_BALANCE" : null,
        balanceCny: Math.round(balanceCny),
        unavailableUntil: balanceCny <= 0 ? new Date(now.getTime() + CIRCUIT_OPEN_MS) : null,
        lastAlertAt: alert ? now : previous?.lastAlertAt,
        updatedAt: now,
      },
    });

  if (alert) {
    await sendAlert(
      "[ima ima] GPTProto 余额低于安全线",
      `GPTProto 当前余额约为 ¥${balanceCny.toFixed(2)}，低于 ¥${threshold}。建议立即充值并保持一至两周安全储备。`
    );
  }
  return { checked: true as const, balanceCny, low };
}
