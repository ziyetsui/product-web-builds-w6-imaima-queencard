const { createDisabledPaymentProvider } = require("./disabled-provider");
const { createMockPaymentProvider } = require("./mock-provider");
const { createWechatPayV3Provider } = require("./wechat-pay-v3");

function paymentModeForEnv(env = process.env) {
  const production = ["production", "prod"].includes(String(env.NODE_ENV || "").toLowerCase());
  const configured = String(env.PAYMENT_PROVIDER || env.MINIAPP_PAYMENT_MODE || (production ? "disabled" : "mock"))
    .trim()
    .toLowerCase();
  if (configured === "mock" && production) return "disabled";
  if (["wechat", "mock", "disabled", "manual"].includes(configured)) return configured === "manual" ? "disabled" : configured;
  return "disabled";
}

function createPaymentProvider(options = {}) {
  const mode = paymentModeForEnv(options.env || process.env);
  if (mode === "wechat") {
    return createWechatPayV3Provider(options);
  }
  if (mode === "mock") return createMockPaymentProvider();
  return createDisabledPaymentProvider();
}

module.exports = { createPaymentProvider, paymentModeForEnv };
