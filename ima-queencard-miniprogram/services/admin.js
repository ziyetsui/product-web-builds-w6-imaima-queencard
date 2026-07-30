var api = require("./api.js");

function recordsFrom(payload, keys) {
  var source = payload || {};
  var i = 0;
  if (Array.isArray(source)) return source;
  for (i = 0; i < keys.length; i += 1) {
    if (Array.isArray(source[keys[i]])) return source[keys[i]];
  }
  if (source.data) return recordsFrom(source.data, keys);
  return [];
}

function normalizeUser(raw) {
  var item = raw || {};
  return {
    id: item.id || item.userId || item.openid || "",
    label: item.nickname || item.nickName || item.name || item.email || item.openid || item.id || "用户",
    credits: Number(item.credits || item.balance || item.availableCredits || 0),
    role: item.role || (item.isAdmin ? "admin" : "user"),
    raw: item,
  };
}

function normalizeOrder(raw) {
  var item = raw || {};
  return {
    id: item.id || item.orderId || item.orderNo || "",
    userId: item.userId || item.user_id || "",
    title: item.productName || item.product_name || item.productId || "订单",
    amount: item.amountLabel || item.priceLabel || item.amount || item.totalAmount || "",
    status: item.status || item.state || "",
    raw: item,
  };
}

function normalizeAudit(raw) {
  var item = raw || {};
  return {
    id: item.id || item.auditId || item.createdAt || "",
    action: item.action || item.type || "payment",
    actor: item.actorEmail || item.actor || item.actorUserId || "",
    target: item.targetUserId || item.userId || item.orderId || "",
    createdAt: item.createdAt || item.created_at || "",
    raw: item,
  };
}

function listAdminUsers(query) {
  return api.listAdminUsers(query || {}).then(function (payload) {
    return recordsFrom(payload, ["users", "records", "items"]).map(normalizeUser);
  });
}

function listAdminOrders(query) {
  return api.listAdminOrders(query || {}).then(function (payload) {
    return recordsFrom(payload, ["orders", "records", "items"]).map(normalizeOrder);
  });
}

function listAdminPaymentAudit(query) {
  return api.listAdminPaymentAudit(query || {}).then(function (payload) {
    return recordsFrom(payload, ["audit", "logs", "records", "items"]).map(normalizeAudit);
  });
}

function adminAddCredits(input) {
  return api.adminAddCredits(input || {});
}

module.exports = {
  listAdminUsers: listAdminUsers,
  listAdminOrders: listAdminOrders,
  listAdminPaymentAudit: listAdminPaymentAudit,
  adminAddCredits: adminAddCredits,
};
