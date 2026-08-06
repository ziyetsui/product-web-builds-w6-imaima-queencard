const PRODUCT_FIELDS = [
  "id",
  "type",
  "title",
  "name",
  "subtitle",
  "description",
  "credits",
  "amountCents",
  "currency",
  "interval",
  "badge",
];

function cloneProduct(product) {
  return product ? JSON.parse(JSON.stringify(product)) : null;
}

function serializeProductSnapshot(product) {
  if (!product || typeof product !== "object") return null;
  const snapshot = {};
  for (const field of PRODUCT_FIELDS) {
    if (product[field] !== undefined) snapshot[field] = product[field];
  }
  return snapshot;
}

function serializeOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    productId: order.productId,
    channel: order.channel || "wechat",
    status: order.status || "pending",
    paymentStatus: order.paymentStatus || "",
    paymentMode: order.paymentMode || "",
    amountCents: Number(order.amountCents || 0),
    currency: order.currency || "CNY",
    credits: Number(order.credits || 0),
    creditsGranted: Number(order.creditsGranted || 0),
    creditsRevoked: Number(order.creditsRevoked || 0),
    productSnapshot: serializeProductSnapshot(order.productSnapshot),
    createdAt: order.createdAt || "",
    updatedAt: order.updatedAt || "",
    paidAt: order.paidAt || null,
    fulfilledAt: order.fulfilledAt || null,
    refundedAt: order.refundedAt || null,
    canceledAt: order.canceledAt || null,
    refundStatus: order.refundStatus || "none",
    refundAcceptedAt: order.refundAcceptedAt || null,
    refundCompletedAt: order.refundCompletedAt || null,
  };
}

function serializeOrderPage(page) {
  const source = page || {};
  return {
    records: Array.isArray(source.records) ? source.records.map(serializeOrder) : [],
    pagination: source.pagination || { page: 1, limit: 0, total: 0, totalPages: 1 },
  };
}

function serializeCreditTransaction(record) {
  if (!record) return null;
  return {
    id: record.id,
    amount: Number(record.amount || 0),
    reason: record.reason || "",
    balanceAfter: Number(record.balanceAfter || 0),
    createdAt: record.createdAt || "",
    orderId: record.orderId || "",
    taskId: record.taskId || "",
  };
}

function serializeCreditPage(page) {
  const source = page || {};
  return {
    records: Array.isArray(source.records) ? source.records.map(serializeCreditTransaction) : [],
    pagination: source.pagination || { page: 1, limit: 0, total: 0, totalPages: 1 },
  };
}

function serializePaymentEvent(event) {
  if (!event) return null;
  return {
    id: event.id,
    orderId: event.orderId || "",
    type: event.type || "",
    message: event.message || "",
    createdAt: event.createdAt || "",
    metadata: event.metadata && typeof event.metadata === "object"
      ? { ...event.metadata }
      : null,
  };
}

function serializePaymentPage(page) {
  const source = page || {};
  return {
    records: Array.isArray(source.records) ? source.records.map(serializePaymentEvent) : [],
    pagination: source.pagination || { page: 1, limit: 0, total: 0, totalPages: 1 },
  };
}

module.exports = {
  cloneProduct,
  serializeOrder,
  serializeOrderPage,
  serializeCreditPage,
  serializePaymentPage,
};
