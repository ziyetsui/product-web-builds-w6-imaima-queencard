var env = require("../../config/env.js");
var api = require("../../services/api.js");
var generation = require("../../services/generation.js");

var MAX_POLL_ATTEMPTS = 12;

function decodeOption(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return String(value || "");
  }
}

function isDone(status) {
  return generation.terminalStatuses.indexOf(generation.statusValue(status)) >= 0;
}

function previousGeneratePage() {
  var pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  var previous = pages.length > 1 ? pages[pages.length - 2] : null;
  if (previous && previous.route === "pages/generate/index") return previous;
  return null;
}

function safeAssetFromImage(image) {
  var item = image || {};
  return {
    assetId: typeof item === "string" ? "" : (item.assetId || ""),
    downloadUrl: typeof item === "string" ? "" : (item.downloadUrl || item.signedUrl || ""),
    url: typeof item === "string" ? item : (item.url || ""),
  };
}

function saveDownloadedFile(filePath) {
  wx.saveImageToPhotosAlbum({
    filePath: filePath,
    success: function () {
      wx.showToast({ title: "已保存", icon: "success" });
    },
    fail: function () {
      wx.showToast({ title: "保存失败，请检查相册权限", icon: "none" });
    },
  });
}

Page({
  pollTimer: null,
  pollRequestVersion: 0,
  pollAttempts: 0,

  data: {
    apiReady: api.isConfigured(),
    taskId: "",
    loading: false,
    task: null,
    statusTitle: "正在读取任务",
    statusDesc: "页面会自动刷新任务状态。",
    images: [],
    imageItems: [],
    error: "",
    regenerating: false,
    savingIndex: -1,
    pollExhausted: false,
    maxPollAttempts: MAX_POLL_ATTEMPTS,
  },

  onLoad: function (options) {
    var taskId = options && options.taskId ? decodeOption(options.taskId) : "";
    this.setData({
      apiReady: api.isConfigured(),
      taskId: taskId,
    });
  },

  onShow: function () {
    if (!this.data.apiReady || !this.data.taskId) return;
    this.fetchTask({ manual: true });
  },

  onUnload: function () {
    this.stopPolling();
  },

  stopPolling: function () {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollRequestVersion += 1;
  },

  schedulePolling: function () {
    var page = this;
    var decision = generation.pollDecision(this.pollAttempts, MAX_POLL_ATTEMPTS, false);
    if (!decision.shouldPoll) {
      this.setData({
        pollExhausted: true,
        statusDesc: "自动刷新已暂停，请点击刷新继续。",
      });
      return;
    }
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(function () {
      page.pollTimer = null;
      page.fetchTask({ manual: false });
    }, env.POLL_INTERVAL_MS);
  },

  fetchTask: function (options) {
    var page = this;
    var manual = Boolean(options && options.manual);
    var requestId = "poll-" + (this.pollRequestVersion + 1);
    if (!this.data.taskId || (this.data.loading && !manual)) return;
    this.stopPolling();
    if (manual) this.pollAttempts = 0;
    this.pollAttempts += 1;
    requestId = "poll-" + this.pollRequestVersion;
    this.setData({
      loading: true,
      error: "",
      pollExhausted: false,
    });

    generation.getTask(this.data.taskId)
      .then(function (result) {
        if (!generation.isCurrentPollRequest(requestId, "poll-" + page.pollRequestVersion)) return;
        var task = generation.normalizeTask(result);
        page.setData({
          loading: false,
          task: task,
          statusTitle: task.title,
          statusDesc: task.desc,
          images: task.images,
          imageItems: task.imageItems,
          error: "",
          pollExhausted: false,
        });
        if (!isDone(task.status)) page.schedulePolling();
      })
      .catch(function (error) {
        if (!generation.isCurrentPollRequest(requestId, "poll-" + page.pollRequestVersion)) return;
        page.setData({
          loading: false,
          error: error.message || "拉取任务失败，请点击刷新重试。",
        });
        page.schedulePolling();
      });
  },

  openHistory: function () {
    wx.navigateTo({ url: "/pages/history/index" });
  },

  backToGenerate: function () {
    this.stopPolling();
    if (previousGeneratePage()) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.reLaunch({ url: "/pages/generate/index" });
  },

  continueEditing: function (event) {
    var index = Number(event && event.currentTarget ? event.currentTarget.dataset.index : 0);
    var selected = this.data.imageItems[index] || this.data.imageItems[0] || null;
    var task = this.data.task || {};
    var references = generation.continuationReferenceState(task, selected && selected.url, 3);
    var previous = previousGeneratePage();
    var updates = {
      referenceImagePath: references.referenceImagePath,
      referenceImagePaths: references.referenceImagePaths,
      referenceAssetIds: references.referenceAssetIds,
      capability: "image-edit",
      sourceTaskId: task.id || this.data.taskId,
      prompt: task.prompt || "",
      topic: task.topic || "",
      templateId: task.templateId || "",
    };

    this.stopPolling();
    if (previous && typeof previous.setData === "function") {
      previous.setData(updates);
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.navigateTo({ url: generation.buildGenerateUrlFromTask(task, { referenceImage: selected && selected.url }) });
  },

  reuseImage: function (event) {
    this.continueEditing(event);
  },

  regenerateTask: function () {
    var page = this;
    if (!this.data.apiReady || !this.data.taskId || this.data.regenerating) return;
    this.stopPolling();
    this.setData({ regenerating: true, error: "" });
    generation.regenerateTask(this.data.taskId)
      .then(function (result) {
        var nextTaskId = result.taskId || (result.task && result.task.id) || "";
        if (!nextTaskId) throw new Error("后端没有返回新的任务 ID");
        page.setData({ regenerating: false, taskId: nextTaskId, task: null, images: [], imageItems: [], statusTitle: "正在读取任务", statusDesc: "页面会自动刷新任务状态。" });
        page.fetchTask({ manual: true });
      })
      .catch(function (error) {
        page.setData({ regenerating: false, error: error.message || "重新生成失败，请稍后重试。" });
      });
  },

  retryTask: function () {
    this.regenerateTask();
  },

  manualRefresh: function () {
    this.fetchTask({ manual: true });
  },

  previewImage: function (event) {
    var current = event.currentTarget.dataset.current;
    if (!current || this.data.images.length === 0) return;
    wx.previewImage({ current: current, urls: this.data.images });
  },

  downloadAndSave: function (url, useAuth) {
    var page = this;
    if (!url) return;
    wx.downloadFile({
      url: url,
      header: useAuth ? api.authHeader() : {},
      success: function (res) {
        if (res.statusCode !== 200) {
          wx.showToast({ title: "下载失败，请稍后重试", icon: "none" });
          page.setData({ savingIndex: -1 });
          return;
        }
        saveDownloadedFile(res.tempFilePath);
        page.setData({ savingIndex: -1 });
      },
      fail: function () {
        wx.showToast({ title: "下载失败，请稍后重试", icon: "none" });
        page.setData({ savingIndex: -1 });
      },
    });
  },

  saveImage: function (event) {
    var page = this;
    var index = Number(event.currentTarget.dataset.index || 0);
    var item = this.data.imageItems[index];
    var safeAsset = safeAssetFromImage(item);
    var safeEndpoint = "";

    if (!generation.canSaveOutput(this.data.task, item)) {
      wx.showToast({ title: "结果尚未准备好，暂不能保存", icon: "none" });
      return;
    }
    this.setData({ savingIndex: index });
    safeEndpoint = api.buildImageAssetDownloadEndpoint(safeAsset.assetId);
    api.getImageAssetDownloadUrl(safeAsset.assetId)
      .then(function (downloadUrl) {
        page.downloadAndSave(downloadUrl || safeEndpoint, true);
      })
      .catch(function () {
        page.downloadAndSave(safeEndpoint, true);
      });
  },

  createAnother: function () {
    this.backToGenerate();
  },
});
