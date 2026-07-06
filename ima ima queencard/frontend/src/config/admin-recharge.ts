export const ADMIN_RECHARGE_CONFIG = {
  quickAmounts: [100, 500],
  defaultExpiryDays: 365,
  minCredits: 1,
  maxCreditsPerOrder: 10000,
  defaultCurrency: "CNY",
  supportedCurrencies: ["CNY", "USD"],
  paymentChannels: ["wechat", "alipay", "bank", "other"],
  defaultPageSize: 50,
  maxPageSize: 100,
  lowBalanceThreshold: 100,
} as const;

export type AdminRechargeCurrency =
  (typeof ADMIN_RECHARGE_CONFIG.supportedCurrencies)[number];

export type AdminRechargePaymentChannel =
  (typeof ADMIN_RECHARGE_CONFIG.paymentChannels)[number];

export const ADMIN_RECHARGE_PAYMENT_CHANNEL_LABELS: Record<
  AdminRechargePaymentChannel,
  string
> = {
  wechat: "微信",
  alipay: "支付宝",
  bank: "银行转账",
  other: "其他",
};
