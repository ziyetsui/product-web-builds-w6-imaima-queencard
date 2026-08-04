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
  var amount = item.amount || item.totalAmount || item.price;
  var cents = item.amountCents !== undefined ? item.amountCents : item.amount_cents;
  if (amount === undefined && cents !== undefined) amount = Number(cents || 0) / 100;
  return {
    id: item.id || item.orderId || item.orderNo || "",
    productId: item.productId || item.product_id || product.id || "",
    productName: item.productName || item.product_name || product.name || "积分订单",
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

function mockPayOrder(orderId) {
  return api.mockPayOrder(orderId).then(normalizeOrderResult);
}

function listOrders(query) {
  return api.listOrders(query || {}).then(normalizeOrderList);
}

function getBilling(query) {
  return api.getBilling(query || {}).then(normalizeBillingList);
}

module.exports = {
  listPricingProducts: listPricingProducts,
  createOrder: createOrder,
  mockPayOrder: mockPayOrder,
  listOrders: listOrders,
  getBilling: getBilling,
  normalizeProducts: normalizeProducts,
  normalizeOrderResult: normalizeOrderResult,
  normalizeBillingList: normalizeBillingList,
  normalizeBillingRow: normalizeBillingRow,
};
