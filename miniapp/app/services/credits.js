var api = require("./api.js");

function normalizeBalance(payload) {
  var balance = payload || {};
  return {
    balance: Number(balance.balance || balance.credits || 0),
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
    balanceAfter: Number(item.balanceAfter || item.balance_after || 0),
    createdAt: item.createdAt || item.created_at || "",
    raw: item,
  };
}

function normalizeHistory(payload) {
  var source = payload || {};
  var records = source.records || source.data || source.items || [];
  var normalized = [];
  var i = 0;

  if (!Array.isArray(records)) records = [];
  for (i = 0; i < records.length; i += 1) {
    normalized.push(normalizeTransaction(records[i]));
  }

  return {
    records: normalized,
    pagination: source.pagination || {
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
};
