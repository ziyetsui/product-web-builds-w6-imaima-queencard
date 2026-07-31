var env = require("../../config/env.js");
var api = require("../../services/api.js");
var generation = require("../../services/generation.js");

function isDone(status) {
  return ["completed", "succeeded", "success", "failed", "error", "canceled", "cancelled"].indexOf(status) >= 0;
}

function previousGeneratePage() {
  var pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  var previous = pages.length > 1 ? pages[pages.length - 2] : null;
  if (previous && previous.route === "pages/generate/index") return previous;
  return null;
}

function safeAssetFromImage(image) {
  var item = image || {};
  var url = typeof item === "string" ? item : item.url;
  var assetId = typeof item === "string" ? "" : item.assetId;
  if (assetId) {
    return {
      assetId: assetId,
      encoded: false,
      url: url || "",
    };
  }
  if (!url || url.indexOf("http") !== 0) {
    return {
      assetId: "",
      encoded: false,
      url: url || "",
    };
  }
  return {
    assetId: encodeURIComponent(url),
    encoded: true,
    url: url,
  };
}

function saveDownloadedFile(filePath) {
  wx.saveImageToPhotosAlbum({
    filePath: filePath,
    success: function () {
      wx.showToast({
        title: "已保存",
        icon: "success",
      });
    },
    fail: function () {
      wx.showToast({
        title: "保存失败",
        icon: "none",
      });
    },
  });
}

Page({
  pollTimer: null,

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
  },

  onLoad: function (options) {
    var taskId = options && options.taskId ? decodeURIComponent(options.taskId) : "";
    this.setData({
      apiReady: api.isConfigured(),
      taskId: taskId,
    });
  },

  onShow: function () {
    if (!this.data.apiReady) return;
    if (!this.data.taskId) return;
    this.fetchTask();
  },

  onUnload: function () {
    this.stopPolling();
  },

  stopPolling: function () {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  },

  schedulePolling: function () {
    var page = this;
    this.stopPolling();
    this.pollTimer = setTimeout(function () {
      page.fetchTask();
    }, env.POLL_INTERVAL_MS);
  },

  fetchTask: function () {
    var page = this;
    if (!this.data.taskId || this.data.loading) return;
    this.setData({
      loading: true,
      error: "",
    });

    generation.getTask(this.data.taskId)
      .then(function (result) {
        var task = generation.normalizeTask(result);
        page.setData({
          loading: false,
          task: task,
          statusTitle: task.title,
          statusDesc: task.desc,
          images: task.images,
          imageItems: task.imageItems,
          error: "",
        });
        if (!isDone(task.status)) {
          page.schedulePolling();
        }
      })
      .catch(function (error) {
        page.setData({
          loading: false,
          error: error.message || "拉取任务失败",
        });
        page.schedulePolling();
      });
  },

  openHistory: function () {
    wx.navigateTo({
      url: "/pages/history/index",
      fail: function () {
        wx.showModal({
          title: "我的作品未注册",
          content: "历史页会在 Task 3 加入 app.json 后打开。本次只接入结果页入口和服务调用。",
          showCancel: false,
        });
      },
    });
  },

  reuseImage: function (event) {
    var imageUrl = event.currentTarget.dataset.url || this.data.images[0] || "";
    var task = this.data.task || {};
    var url = "";
    var previous = null;

    if (!imageUrl) {
      wx.showToast({
        title: "还没有可复用图片",
        icon: "none",
      });
      return;
    }

    this.stopPolling();
    url = generation.buildGenerateUrlFromTask(task, {
      referenceImage: imageUrl,
    });
    previous = previousGeneratePage();

    if (previous && typeof previous.setData === "function") {
      previous.setData({
        referenceImagePath: imageUrl,
        prompt: task.prompt || "",
        topic: task.topic || "",
        templateId: task.templateId || "",
        sourceTaskId: task.id || this.data.taskId,
      });
      wx.navigateBack({
        delta: 1,
      });
      return;
    }

    wx.navigateTo({
      url: url,
    });
  },

  regenerateTask: function () {
    var page = this;
    if (!this.data.apiReady || !this.data.taskId || this.data.regenerating) return;

    this.stopPolling();
    this.setData({
      regenerating: true,
      error: "",
    });

    generation.regenerateTask(this.data.taskId)
      .then(function (result) {
        var nextTaskId = result.taskId || (result.task && result.task.id) || "";
        page.setData({
          regenerating: false,
        });
        if (!nextTaskId) {
          wx.showModal({
            title: "同款任务已提交",
            content: "后端没有返回新的 taskId，请检查 /api/miniapp/image-generations/:taskId/regenerate 响应格式。",
            showCancel: false,
          });
          return;
        }
        wx.redirectTo({
          url: "/pages/result/index?taskId=" + encodeURIComponent(nextTaskId),
          fail: function () {
            page.setData({
              taskId: nextTaskId,
              task: null,
              images: [],
              statusTitle: "正在读取任务",
              statusDesc: "页面会自动刷新任务状态。",
            });
            page.fetchTask();
          },
        });
      })
      .catch(function (error) {
        page.setData({
          regenerating: false,
          error: error.message || "重新生成失败",
        });
        wx.showModal({
          title: "重新生成失败",
          content: error.message || "请稍后再试",
          showCancel: false,
        });
      });
  },

  manualRefresh: function () {
    this.fetchTask();
  },

  previewImage: function (event) {
    var current = event.currentTarget.dataset.current;
    if (!current || this.data.images.length === 0) return;
    wx.previewImage({
      current: current,
      urls: this.data.images,
    });
  },

  downloadAndSave: function (url, useAuth, fallbackUrl) {
    var page = this;
    if (!url) return;
    wx.downloadFile({
      url: url,
      header: useAuth ? api.authHeader() : {},
      success: function (res) {
        if (res.statusCode !== 200) {
          if (fallbackUrl && fallbackUrl !== url) {
            page.downloadAndSave(fallbackUrl, false, "");
            return;
          }
          wx.showToast({
            title: "下载失败",
            icon: "none",
          });
          return;
        }
        saveDownloadedFile(res.tempFilePath);
      },
      fail: function () {
        if (fallbackUrl && fallbackUrl !== url) {
          page.downloadAndSave(fallbackUrl, false, "");
          return;
        }
        wx.showToast({
          title: "下载失败",
          icon: "none",
        });
      },
    });
  },

  saveImage: function (event) {
    var index = Number(event.currentTarget.dataset.index || 0);
    var url = event.currentTarget.dataset.url || "";
    var item = this.data.imageItems[index] || { url: url };
    var safeAsset = safeAssetFromImage(item);
    var safeEndpoint = "";
    var page = this;

    if (!url && safeAsset.url) url = safeAsset.url;
    if (!safeAsset.assetId) {
      this.downloadAndSave(url, false, "");
      return;
    }

    safeEndpoint = api.buildImageAssetDownloadEndpoint(safeAsset.assetId, {
      encoded: safeAsset.encoded,
    });

    api.getImageAssetDownloadUrl(safeAsset.assetId, { encoded: safeAsset.encoded })
      .then(function (downloadUrl) {
        page.downloadAndSave(downloadUrl || safeEndpoint, !downloadUrl, url);
      })
      .catch(function () {
        page.downloadAndSave(safeEndpoint, true, url);
      });
  },

  createAnother: function () {
    this.stopPolling();
    if (typeof getCurrentPages === "function" && getCurrentPages().length > 1) {
      wx.navigateBack({
        delta: 1,
      });
      return;
    }
    wx.reLaunch({
      url: "/pages/generate/index",
    });
  },
});
