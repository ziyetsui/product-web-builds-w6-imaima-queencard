var api = require("./api.js");

function recordsFrom(payload, keys) {
  var source = payload || {};
  var i = 0;
  if (Array.isArray(source)) return source;
  for (i = 0; i < keys.length; i += 1) {
    if (Array.isArray(source[keys[i]])) return source[keys[i]];
  }
  for (i = 0; i < keys.length; i += 1) {
    if (source[keys[i]] && typeof source[keys[i]] === "object") {
      var nested = recordsFrom(source[keys[i]], keys);
      if (nested.length) return nested;
    }
  }
  if (source.records && typeof source.records === "object") return recordsFrom(source.records, keys);
  if (source.data) return recordsFrom(source.data, keys);
  return [];
}

function formatMoney(value, currency) {
  var amount = Number(value || 0);
  var unit = currency || "CNY";
  if (unit === "CNY" || unit === "RMB" || unit === "cny") return "¥" + amount;
  return amount + " " + unit;
}

var PAYMENT_STATE_COPY = {
  pending: {
    label: "待支付",
    message: "订单已创建，请完成支付。",
  },
  user_canceled: {
    label: "已取消支付",
    message: "你已取消本次支付，订单仍待支付。",
  },
  paid_syncing: {
    label: "支付已提交",
    message: "支付已提交，积分正在同步，请稍后查看订单。",
  },
  refund_pending: {
    label: "退款处理中",
    message: "退款申请已提交，结果正在同步，请稍后查看订单。",
  },
  refunding: {
    label: "退款处理中",
    message: "退款申请已提交，结果正在同步，请稍后查看订单。",
  },
  fulfilled: {
    label: "已完成",
    message: "支付已完成，积分已到账。",
  },
  failed: {
    label: "支付失败",
    message: "支付未完成，请稍后重试。",
  },
  canceled: {
    label: "订单已取消",
    message: "订单已取消，未发放积分。",
  },
  refunded: {
    label: "已退款",
    message: "订单已退款，相关积分已撤回。",
  },
};

function lower(value) {
  return String(value || "").toLowerCase();
}

function getMiniProgramEnvVersion() {
  if (typeof wx === "undefined" || typeof wx.getAccountInfoSync !== "function") return "";
  try {
    var account = wx.getAccountInfoSync();
    return account && account.miniProgram && account.miniProgram.envVersion || "";
  } catch (error) {
    return "";
  }
}

function isProductionEnvironment(envVersion) {
  return lower(envVersion) === "release";
}

function isMockPaymentAvailable(order, envVersion) {
  var version = envVersion === undefined ? getMiniProgramEnvVersion() : envVersion;
  return Boolean(order && order.paymentMode === "mock") && !isProductionEnvironment(version);
}

function describeOrderStatus(order, fallbackState) {
  var item = order || {};
  var status = lower(item.status);
  var paymentStatus = lower(item.paymentStatus);
  var state = "";

  if (status === "refunded" || paymentStatus === "refunded") state = "refunded";
  else if (status === "refund_pending" || paymentStatus === "refund_pending") state = "refund_pending";
  else if (status === "refunding" || paymentStatus === "refunding") state = "refunding";
  else if (status === "canceled" || status === "cancelled" || paymentStatus === "canceled" || paymentStatus === "cancelled") state = "canceled";
  else if (status === "failed" || paymentStatus === "failed") state = "failed";
  else if (
    status === "paid" && (paymentStatus === "fulfilled" || Number(item.creditsGranted || 0) > 0 || item.fulfilledAt)
    || status === "fulfilled"
    || ["fulfilled", "succeeded", "success", "completed"].indexOf(paymentStatus) >= 0
  ) state = "fulfilled";
  else if (fallbackState && PAYMENT_STATE_COPY[fallbackState]) state = fallbackState;
  else if (status === "paid" || ["paid", "processing", "reconciling", "syncing"].indexOf(paymentStatus) >= 0) state = "paid_syncing";
  else state = "pending";

  return {
    state: state,
    label: PAYMENT_STATE_COPY[state].label,
    message: PAYMENT_STATE_COPY[state].message,
  };
}

function describePaymentError(error) {
  var message = lower(error && (error.errMsg || error.message));
  if (message.indexOf("cancel") >= 0 || message.indexOf("取消") >= 0) {
    return {
      state: "user_canceled",
      label: PAYMENT_STATE_COPY.user_canceled.label,
      message: PAYMENT_STATE_COPY.user_canceled.message,
    };
  }
  return {
    state: "failed",
    label: PAYMENT_STATE_COPY.failed.label,
    message: PAYMENT_STATE_COPY.failed.message,
  };
}

function normalizeProduct(raw, index) {
  var item = raw || {};
  var amount = item.price !== undefined ? item.price : item.amount;
  var cents = item.amountCents !== undefined ? item.amountCents : item.amount_cents;
  var credits = item.credits !== undefined ? item.credits : item.creditAmount;
  if (amount === undefined && cents !== undefined) amount = Number(cents || 0) / 100;
  return {
    id: item.id || item.productId || item.key || "product-" + index,
    name: item.name || item.title || "积分套餐",
    type: item.type || "pack",
    credits: Number(credits || 0),
    amountCents: Number(cents || 0),
    currency: item.currency || "CNY",
    price: typeof amount === "string" ? amount : formatMoney(amount, item.currency),
    desc: item.desc || item.description || item.subtitle || "用于生成、编辑和保存高质量图文结果。",
    interval: item.interval || "",
    badge: item.badge || "",
    paymentAvailable: item.paymentAvailable !== false,
    accent: item.accent || ["lemon", "seafoam", "pumpkin"][index % 3],
    raw: item,
  };
}

function normalizeProducts(payload) {
  var source = payload || {};
  var products = recordsFrom(source, ["products", "records", "items"]);
  var paymentAvailable = source.payment && source.payment.available !== undefined
    ? Boolean(source.payment.available)
    : undefined;
  if (products.length === 0 && (Array.isArray(source.packs) || Array.isArray(source.subscriptions))) {
    products = (source.packs || []).concat(source.subscriptions || []);
  }
  return products.map(function (product, index) {
    var normalized = normalizeProduct(product, index);
    if (paymentAvailable !== undefined && product.paymentAvailable === undefined) {
      normalized.paymentAvailable = paymentAvailable;
    }
    return normalized;
  });
}

function normalizeOrder(raw) {
  var item = raw || {};
  var product = item.product || {};
  var productSnapshot = item.productSnapshot || item.product_snapshot || {};
  var amount = item.amount || item.totalAmount || item.price;
  var cents = item.amountCents !== undefined ? item.amountCents : item.amount_cents;
  if (amount === undefined && cents !== undefined) amount = Number(cents || 0) / 100;
  return {
    id: item.id || item.orderId || item.orderNo || "",
    productId: item.productId || item.product_id || product.id || "",
    productName: item.productName || item.product_name || productSnapshot.name || productSnapshot.title || product.name || product.title || "积分订单",
    amountLabel: item.amountLabel || item.priceLabel || formatMoney(amount, item.currency),
    amountCents: Number(cents || 0),
    currency: item.currency || "CNY",
    credits: Number(item.credits || item.creditAmount || product.credits || 0),
    creditsGranted: Number(item.creditsGranted || item.credits_granted || 0),
    status: item.status || item.state || "pending",
    paymentStatus: item.paymentStatus || item.payment_status || "",
    paymentMode: item.paymentMode || item.payment_mode || "",
    channel: item.channel || item.paymentChannel || "wechat",
    createdAt: item.createdAt || item.created_at || "",
    paidAt: item.paidAt || item.paid_at || "",
    fulfilledAt: item.fulfilledAt || item.fulfilled_at || null,
    refundedAt: item.refundedAt || item.refunded_at || null,
    canceledAt: item.canceledAt || item.canceled_at || null,
    creditsRevoked: Number(item.creditsRevoked !== undefined ? item.creditsRevoked : item.credits_revoked || 0),
    productSnapshot: item.productSnapshot || item.product_snapshot || null,
    raw: item,
  };
}

function normalizeOrderResult(payload) {
  var source = payload || {};
  var order = source.order || source.data || source;
  return {
    order: normalizeOrder(order),
    paymentParams: source.paymentParams || source.payParams || source.wxPayParams || null,
    raw: source,
  };
}

function normalizeOrderList(payload) {
  return recordsFrom(payload, ["orders", "records", "items"]).map(normalizeOrder);
}

function normalizeBillingRow(raw) {
  var item = raw || {};
  var amount = item.amount || item.totalAmount;
  var cents = item.amountCents !== undefined ? item.amountCents : item.amount_cents;
  if (amount === undefined && cents !== undefined) amount = Number(cents || 0) / 100;
  return {
    id: item.id || item.invoiceId || item.billingId || item.createdAt || "",
    title: item.title || item.description || item.productName || item.reason || item.type || "账单记录",
    amountLabel: item.amountLabel || item.priceLabel || formatMoney(amount, item.currency),
    status: item.status || item.state || "recorded",
    type: item.type || "",
    orderId: item.orderId || item.order_id || "",
    createdAt: item.createdAt || item.created_at || item.paidAt || item.paid_at || "",
    raw: item,
  };
}

function normalizeBillingList(payload) {
  var source = payload || {};
  var rows = [];
  var creditRows = recordsFrom(source.creditTransactions || {}, ["records", "items", "transactions"]);
  var paymentRows = recordsFrom(source.paymentEvents || {}, ["records", "items", "events"]);
  if (creditRows.length || paymentRows.length) rows = creditRows.concat(paymentRows);
  else rows = recordsFrom(source, ["billing", "rows", "records", "items", "invoices"]);
  return rows.map(normalizeBillingRow);
}

function listPricingProducts() {
  return api.listPricingProducts().then(normalizeProducts);
}

function createOrder(productId, channel) {
  return api.createOrder(productId, channel || "wechat").then(normalizeOrderResult);
}

function reconcileOrder(orderId) {
  return api.request({
    path: "/orders/" + encodeURIComponent(orderId || "") + "/reconcile",
    method: "POST",
  }).then(normalizeOrderResult);
}

function mockPayOrder(orderId) {
  return api.mockPayOrder(orderId).then(normalizeOrderResult);
}

function listOrders(query) {
  return api.listOrders(query || {}).then(normalizeOrderList);
}

function getOrder(orderId) {
  return api.getOrder(orderId).then(function (payload) {
    return normalizeOrderResult(payload).order;
  });
}

function getBilling(query) {
  return api.getBilling(query || {}).then(normalizeBillingList);
}

module.exports = {
  listPricingProducts: listPricingProducts,
  createOrder: createOrder,
  mockPayOrder: mockPayOrder,
  listOrders: listOrders,
  getOrder: getOrder,
  getBilling: getBilling,
  reconcileOrder: reconcileOrder,
  normalizeProducts: normalizeProducts,
  normalizeOrderResult: normalizeOrderResult,
  normalizeBillingList: normalizeBillingList,
  normalizeBillingRow: normalizeBillingRow,
  describeOrderStatus: describeOrderStatus,
  describePaymentError: describePaymentError,
  isMockPaymentAvailable: isMockPaymentAvailable,
  isProductionEnvironment: isProductionEnvironment,
};
