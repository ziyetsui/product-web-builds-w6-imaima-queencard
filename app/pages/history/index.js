var api = require("../../services/api.js");
var auth = require("../../services/auth.js");
var generation = require("../../services/generation.js");

var PAGE_SIZE = 10;
var STATUS_FILTERS = [
  { label: "全部", value: "" },
  { label: "生成中", value: "processing" },
  { label: "已完成", value: "completed" },
  { label: "失败", value: "failed" },
];

function trim(value) {
  return String(value || "").replace(/^\s+|\s+$/g, "");
}

function pickRecords(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.tasks)) return payload.tasks;
  if (payload.data && Array.isArray(payload.data.records)) return payload.data.records;
  if (Array.isArray(payload)) return payload;
  return [];
}

function normalizePagination(payload, page, records) {
  var pagination = payload && payload.pagination ? payload.pagination : {};
  var hasMore = false;
  if (typeof pagination.hasMore === "boolean") {
    hasMore = pagination.hasMore;
  } else if (pagination.totalPages) {
    hasMore = page < Number(pagination.totalPages);
  } else if (pagination.total) {
    hasMore = page * PAGE_SIZE < Number(pagination.total);
  } else {
    hasMore = records.length >= PAGE_SIZE;
  }
  return {
    page: Number(pagination.page || page),
    total: Number(pagination.total || 0),
    hasMore: hasMore,
  };
}

Page({
  searchTimer: null,

  data: {
    apiReady: api.isConfigured(),
    user: null,
    q: "",
    statusFilters: STATUS_FILTERS,
    statusIndex: 0,
    statusFilter: "",
    records: [],
    page: 1,
    hasMore: true,
    loading: false,
    loadingMore: false,
    refreshing: false,
    retryingId: "",
    error: "",
    searched: false,
    loginRequired: false,
  },

  onLoad: function () {
    this.syncAuthState();
  },

  onShow: function () {
    this.syncAuthState(true);
  },

  onUnload: function () {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },

  syncAuthState: function (load) {
    var user = auth.getCurrentUser();
    var configured = api.isConfigured();
    this.setData({
      apiReady: configured,
      user: user,
      loginRequired: configured && !user,
      error: configured && !user ? "" : this.data.error,
    });
    if (!configured || !user) return;
    if (load) this.loadRecords({ reset: true });
  },

  handleLogin: function () {
    var page = this;
    if (!this.data.apiReady) {
      wx.showModal({ title: "后端未配置", content: "请先设置 API_BASE_URL。", showCancel: false });
      return;
    }
    this.setData({ loading: true, error: "" });
    auth.loginWithWechatProfile({ source: "history" })
      .then(function (result) {
        page.setData({ user: result.user || auth.getCurrentUser(), loginRequired: false, loading: false });
        page.loadRecords({ reset: true });
      })
      .catch(function (error) {
        page.setData({ loading: false, error: error.message || "登录失败，请稍后重试。" });
      });
  },

  onPullDownRefresh: function () {
    this.loadRecords({ reset: true, refreshing: true });
  },

  onReachBottom: function () {
    if (!this.data.hasMore || this.data.loading || this.data.loadingMore) return;
    this.loadRecords({ reset: false });
  },

  onSearchInput: function (event) {
    var page = this;
    var value = event.detail.value;
    this.setData({ q: value, searched: Boolean(trim(value)) });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(function () {
      page.loadRecords({ reset: true });
    }, 350);
  },

  clearSearch: function () {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ q: "", searched: false });
    this.loadRecords({ reset: true });
  },

  onStatusChange: function (event) {
    var index = Number(event.detail.value);
    var filter = this.data.statusFilters[index] || this.data.statusFilters[0];
    this.setData({ statusIndex: index, statusFilter: filter.value });
    this.loadRecords({ reset: true });
  },

  loadRecords: function (options) {
    var page = this;
    var reset = !options || options.reset !== false;
    var nextPage = reset ? 1 : this.data.page + 1;
    var query = trim(this.data.q);
    var user = auth.getCurrentUser();

    if (!this.data.apiReady) {
      this.setData({ error: "后端 API 未配置，请先设置 API_BASE_URL。", loading: false, loadingMore: false, refreshing: false, loginRequired: false });
      wx.stopPullDownRefresh();
      return;
    }
    if (!user) {
      this.setData({ loginRequired: true, loading: false, loadingMore: false, refreshing: false, error: "" });
      wx.stopPullDownRefresh();
      return;
    }

    this.setData({ loading: reset, loadingMore: !reset, refreshing: Boolean(options && options.refreshing), error: "" });
    generation.listTasks({
      page: nextPage,
      limit: PAGE_SIZE,
      q: query,
      status: this.data.statusFilter,
    })
      .then(function (payload) {
        var records = pickRecords(payload).map(generation.normalizeHistoryRecord);
        var pagination = normalizePagination(payload, nextPage, records);
        page.setData({
          records: reset ? records : page.data.records.concat(records),
          page: pagination.page || nextPage,
          hasMore: pagination.hasMore,
          loading: false,
          loadingMore: false,
          refreshing: false,
          loginRequired: false,
          error: "",
        });
        wx.stopPullDownRefresh();
      })
      .catch(function (error) {
        page.setData({ loading: false, loadingMore: false, refreshing: false, error: error.message || "作品列表加载失败，请稍后重试。" });
        wx.stopPullDownRefresh();
      });
  },

  refreshRecords: function () {
    this.loadRecords({ reset: true });
  },

  openRecord: function (event) {
    var taskId = event.currentTarget.dataset.id;
    if (!taskId) return;
    wx.navigateTo({ url: "/pages/result/index?taskId=" + encodeURIComponent(taskId) });
  },

  retryRecord: function (event) {
    var page = this;
    var taskId = event.currentTarget.dataset.id;
    if (!taskId || this.data.retryingId) return;
    this.setData({ retryingId: taskId, error: "" });
    generation.regenerateTask(taskId)
      .then(function (result) {
        var nextTaskId = result.taskId || (result.task && result.task.id) || "";
        if (!nextTaskId) throw new Error("后端没有返回新的任务 ID");
        page.setData({ retryingId: "" });
        wx.navigateTo({ url: "/pages/result/index?taskId=" + encodeURIComponent(nextTaskId) });
      })
      .catch(function (error) {
        page.setData({ retryingId: "", error: error.message || "重试失败，请稍后重试。" });
      });
  },

  reuseRecord: function (event) {
    var image = event.currentTarget.dataset.image;
    var taskId = event.currentTarget.dataset.id || "";
    var record = (this.data.records || []).filter(function (item) { return item.id === taskId; })[0];
    if (!image || !record) {
      wx.showToast({ title: "暂无可复用的生成输出", icon: "none" });
      return;
    }
    wx.navigateTo({
      url: generation.buildGenerateUrlFromTask(record.task, { referenceImage: image }),
    });
  },
});
