var api = require("./api.js");

function firstValue(source, keys, fallback) {
  var i = 0;
  for (i = 0; i < keys.length; i += 1) {
    if (source && source[keys[i]] !== undefined && source[keys[i]] !== null) return source[keys[i]];
  }
  return fallback;
}

function recordsFrom(payload) {
  var source = payload || {};
  if (Array.isArray(source)) return source;
  if (source.records && Array.isArray(source.records)) return source.records;
  if (source.items && Array.isArray(source.items)) return source.items;
  if (source.transactions && Array.isArray(source.transactions)) return source.transactions;
  if (source.creditTransactions) return recordsFrom(source.creditTransactions);
  if (source.data) return recordsFrom(source.data);
  return [];
}

function normalizeBalance(payload) {
  var balance = payload && payload.data ? payload.data : (payload || {});
  var available = firstValue(balance, ["availableCredits", "available_credits", "balance", "credits"], 0);
  return {
    balance: Number(available || 0),
    availableCredits: Number(available || 0),
    heldCredits: Number(firstValue(balance, ["heldCredits", "held_credits", "reservedCredits", "reserved_credits"], 0) || 0),
    expiringCredits: Number(firstValue(balance, ["expiringCredits", "expiring_credits"], 0) || 0),
    currency: balance.currency || "credits",
    raw: balance,
  };
}

function normalizeTransaction(record) {
  var item = record || {};
  return {
    id: item.id || item.transactionId || "",
    amount: Number(item.amount || 0),
    reason: item.reason || item.type || "",
    type: item.type || "",
    title: item.title || item.reason || item.type || "积分变动",
    description: item.description || item.memo || item.taskId || "小程序积分流水",
    balanceAfter: Number(item.balanceAfter || item.balance_after || 0),
    createdAt: item.createdAt || item.created_at || "",
    orderId: item.orderId || item.order_id || "",
    taskId: item.taskId || item.task_id || "",
    raw: item,
  };
}

function normalizeHistory(payload) {
  var source = payload || {};
  var container = source.creditTransactions || source.data || source;
  var records = recordsFrom(container);
  var normalized = [];
  var i = 0;

  for (i = 0; i < records.length; i += 1) {
    normalized.push(normalizeTransaction(records[i]));
  }

  return {
    records: normalized,
    pagination: container.pagination || source.pagination || {
      page: 1,
      limit: normalized.length,
      total: normalized.length,
      totalPages: 1,
    },
  };
}

function getBalance() {
  return api.getCreditBalance().then(normalizeBalance);
}

function getHistory(query) {
  return api.getCreditHistory(query || {}).then(normalizeHistory);
}

module.exports = {
  getBalance: getBalance,
  getHistory: getHistory,
  normalizeBalance: normalizeBalance,
  normalizeHistory: normalizeHistory,
  normalizeTransaction: normalizeTransaction,
};
