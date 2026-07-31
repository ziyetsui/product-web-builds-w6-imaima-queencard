var api = require("../../services/api.js");
var generation = require("../../services/generation.js");

var PAGE_SIZE = 10;

function trim(value) {
  return String(value || "").replace(/^\s+|\s+$/g, "");
}

function normalizeImages(value) {
  var result = [];
  var source = value || [];
  var i = 0;
  if (typeof source === "string") return source ? [source] : [];
  for (i = 0; i < source.length; i += 1) {
    if (typeof source[i] === "string") {
      result.push(source[i]);
    } else if (source[i] && source[i].url) {
      result.push(source[i].url);
    } else if (source[i] && source[i].imageUrl) {
      result.push(source[i].imageUrl);
    } else if (source[i] && source[i].src) {
      result.push(source[i].src);
    }
  }
  return result;
}

function statusMeta(status) {
  var value = String(status || "running").toLowerCase();
  if (value === "completed" || value === "succeeded" || value === "success") {
    return { label: "已完成", tone: "success" };
  }
  if (value === "failed" || value === "error") {
    return { label: "失败", tone: "danger" };
  }
  if (value === "queued" || value === "pending") {
    return { label: "排队中", tone: "waiting" };
  }
  if (value === "canceled" || value === "cancelled") {
    return { label: "已取消", tone: "muted" };
  }
  return { label: "生成中", tone: "running" };
}

function formatTime(value) {
  if (!value) return "刚刚";
  var date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  var month = date.getMonth() + 1;
  var day = date.getDate();
  var hour = date.getHours();
  var minute = date.getMinutes();
  return month + "/" + day + " " + (hour < 10 ? "0" + hour : hour) + ":" + (minute < 10 ? "0" + minute : minute);
}

function normalizeRecord(raw) {
  var task = raw || {};
  var nested = task.task || task.generationTask || null;
  var images = [];
  var status = "";
  var meta = null;
  if (nested) task = nested;

  images = normalizeImages(task.images || task.resultImages || task.outputImages || task.outputs || task.assets || task.referenceImages);
  status = task.status || task.state || "running";
  meta = statusMeta(status);

  return {
    id: task.id || task.taskId || task.generationTaskId || "",
    title: task.topic || task.templateTitle || task.model || "未命名作品",
    prompt: task.prompt || task.inputPrompt || task.requestPrompt || "",
    model: task.model || task.modelName || "GPT Image 2",
    status: status,
    statusLabel: meta.label,
    statusTone: meta.tone,
    firstImage: images[0] || "",
    images: images,
    outputCount: task.outputCount || task.count || images.length || 1,
    createdAtLabel: formatTime(task.createdAt || task.updatedAt || task.created_at || task.updated_at),
  };
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

function pickRecords(payload) {
  if (!payload) return [];
  if (payload.records) return payload.records;
  if (payload.items) return payload.items;
  if (payload.tasks) return payload.tasks;
  if (payload.data && payload.data.records) return payload.data.records;
  if (Array.isArray(payload)) return payload;
  return [];
}

Page({
  searchTimer: null,

  data: {
    apiReady: api.isConfigured(),
    q: "",
    records: [],
    page: 1,
    hasMore: true,
    loading: false,
    loadingMore: false,
    refreshing: false,
    error: "",
    searched: false,
  },

  onLoad: function () {
    this.loadRecords({ reset: true });
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
    this.setData({
      q: value,
      searched: Boolean(trim(value)),
    });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(function () {
      page.loadRecords({ reset: true });
    }, 350);
  },

  clearSearch: function () {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({
      q: "",
      searched: false,
    });
    this.loadRecords({ reset: true });
  },

  loadRecords: function (options) {
    var page = this;
    var reset = !options || options.reset !== false;
    var nextPage = reset ? 1 : this.data.page + 1;
    var query = trim(this.data.q);

    if (!this.data.apiReady) {
      this.setData({
        error: "后端 API 未配置，请先设置 API_BASE_URL。",
        loading: false,
        loadingMore: false,
        refreshing: false,
      });
      wx.stopPullDownRefresh();
      return;
    }

    this.setData({
      loading: reset,
      loadingMore: !reset,
      refreshing: Boolean(options && options.refreshing),
      error: "",
    });

    generation.listTasks({
      page: nextPage,
      limit: PAGE_SIZE,
      q: query,
    })
      .then(function (payload) {
        var rawRecords = pickRecords(payload);
        var records = rawRecords.map(normalizeRecord);
        var pagination = normalizePagination(payload, nextPage, records);
        page.setData({
          records: reset ? records : page.data.records.concat(records),
          page: pagination.page || nextPage,
          hasMore: pagination.hasMore,
          loading: false,
          loadingMore: false,
          refreshing: false,
          error: "",
        });
        wx.stopPullDownRefresh();
      })
      .catch(function (error) {
        page.setData({
          loading: false,
          loadingMore: false,
          refreshing: false,
          error: error.message || "作品列表加载失败",
        });
        wx.stopPullDownRefresh();
      });
  },

  refreshRecords: function () {
    this.loadRecords({ reset: true });
  },

  openRecord: function (event) {
    var taskId = event.currentTarget.dataset.id;
    if (!taskId) return;
    wx.navigateTo({
      url: "/pages/result/index?taskId=" + encodeURIComponent(taskId),
    });
  },

  reuseRecord: function (event) {
    var image = event.currentTarget.dataset.image;
    var prompt = event.currentTarget.dataset.prompt || "";
    var taskId = event.currentTarget.dataset.id || "";
    if (!image) {
      wx.showToast({
        title: "暂无可复用图片",
        icon: "none",
      });
      return;
    }
    wx.navigateTo({
      url: "/pages/generate/index?referenceImage=" + encodeURIComponent(image) + "&prompt=" + encodeURIComponent(prompt) + "&sourceTaskId=" + encodeURIComponent(taskId),
    });
  },
});
