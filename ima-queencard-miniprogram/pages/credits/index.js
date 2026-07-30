var api = require("../../services/api.js");
var auth = require("../../services/auth.js");
var credits = require("../../services/credits.js");

var PAGE_SIZE = 12;

function userLabel(user) {
  if (!user) return "未登录";
  return user.name || user.email || user.id || "已登录账号";
}

function normalizeAmount(value) {
  var amount = Number(value || 0);
  if (amount > 0) return "+" + amount;
  return String(amount);
}

function formatTime(value) {
  if (!value) return "刚刚";
  var date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return (date.getMonth() + 1) + "/" + date.getDate() + " " + (date.getHours() < 10 ? "0" + date.getHours() : date.getHours()) + ":" + (date.getMinutes() < 10 ? "0" + date.getMinutes() : date.getMinutes());
}

function normalizeBalance(payload) {
  var source = payload || {};
  if (source.balance !== undefined) return Number(source.balance || 0);
  if (source.credits !== undefined) return Number(source.credits || 0);
  if (source.availableCredits !== undefined) return Number(source.availableCredits || 0);
  if (source.data && source.data.balance !== undefined) return Number(source.data.balance || 0);
  return 0;
}

function pickRecords(payload) {
  if (!payload) return [];
  if (payload.records) return payload.records;
  if (payload.items) return payload.items;
  if (payload.transactions) return payload.transactions;
  if (payload.data && payload.data.records) return payload.data.records;
  if (Array.isArray(payload)) return payload;
  return [];
}

function normalizeTransaction(raw) {
  var item = raw || {};
  var amount = item.amount !== undefined ? item.amount : item.delta;
  return {
    id: item.id || item.transactionId || item.createdAt || item.created_at || String(Math.random()),
    title: item.title || item.reason || item.type || "积分变动",
    desc: item.description || item.memo || item.taskId || "小程序积分流水",
    amountLabel: normalizeAmount(amount),
    tone: Number(amount || 0) >= 0 ? "plus" : "minus",
    createdAtLabel: formatTime(item.createdAt || item.created_at || item.updatedAt || item.updated_at),
  };
}

function hasMore(payload, page, records) {
  var pagination = payload && payload.pagination ? payload.pagination : {};
  if (typeof pagination.hasMore === "boolean") return pagination.hasMore;
  if (pagination.totalPages) return page < Number(pagination.totalPages);
  if (pagination.total) return page * PAGE_SIZE < Number(pagination.total);
  return records.length >= PAGE_SIZE;
}

Page({
  data: {
    apiReady: api.isConfigured(),
    user: null,
    userLabel: "未登录",
    balance: 0,
    records: [],
    page: 1,
    hasMore: true,
    loading: false,
    loadingMore: false,
    error: "",
  },

  onLoad: function () {
    this.syncUser();
    this.loadCredits({ reset: true });
  },

  onShow: function () {
    this.syncUser();
  },

  onPullDownRefresh: function () {
    this.loadCredits({ reset: true, refreshing: true });
  },

  onReachBottom: function () {
    if (!this.data.hasMore || this.data.loading || this.data.loadingMore) return;
    this.loadCredits({ reset: false });
  },

  syncUser: function () {
    var user = auth.getCurrentUser();
    this.setData({
      apiReady: api.isConfigured(),
      user: user,
      userLabel: userLabel(user),
    });
  },

  loadCredits: function (options) {
    var page = this;
    var reset = !options || options.reset !== false;
    var nextPage = reset ? 1 : this.data.page + 1;

    if (!this.data.apiReady) {
      this.setData({
        error: "后端 API 未配置，暂时无法读取积分。",
      });
      wx.stopPullDownRefresh();
      return;
    }

    this.setData({
      loading: reset,
      loadingMore: !reset,
      error: "",
    });

    Promise.all([
      reset ? credits.getBalance() : Promise.resolve({ balance: this.data.balance }),
      credits.getHistory({ page: nextPage, limit: PAGE_SIZE }),
    ])
      .then(function (results) {
        var balancePayload = results[0];
        var historyPayload = results[1];
        var records = pickRecords(historyPayload).map(normalizeTransaction);
        page.setData({
          balance: reset ? normalizeBalance(balancePayload) : page.data.balance,
          records: reset ? records : page.data.records.concat(records),
          page: nextPage,
          hasMore: hasMore(historyPayload, nextPage, records),
          loading: false,
          loadingMore: false,
          error: "",
        });
        wx.stopPullDownRefresh();
      })
      .catch(function (error) {
        page.setData({
          loading: false,
          loadingMore: false,
          error: error.message || "积分读取失败",
        });
        wx.stopPullDownRefresh();
      });
  },

  refreshCredits: function () {
    this.loadCredits({ reset: true });
  },

  goPricing: function () {
    wx.navigateTo({
      url: "/pages/pricing/index",
    });
  },

  goAccount: function () {
    wx.navigateTo({
      url: "/pages/account/index",
    });
  },

  goBilling: function () {
    wx.navigateTo({
      url: "/pages/billing/index",
    });
  },
});
