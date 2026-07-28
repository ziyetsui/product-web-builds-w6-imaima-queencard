var env = require("../../config/env.js");
var api = require("../../services/api.js");

function normalizeImages(value) {
  var result = [];
  var source = value || [];
  var i = 0;
  for (i = 0; i < source.length; i += 1) {
    if (typeof source[i] === "string") {
      result.push(source[i]);
    } else if (source[i] && source[i].url) {
      result.push(source[i].url);
    } else if (source[i] && source[i].imageUrl) {
      result.push(source[i].imageUrl);
    }
  }
  return result;
}

function normalizeTask(raw) {
  var task = raw || {};
  var nested = task.task || task.generationTask || null;
  if (nested) task = nested;

  var status = task.status || task.state || "running";
  var images = normalizeImages(task.images || task.resultImages || task.outputImages || task.outputs || task.assets);
  var error = task.error || task.errorMessage || task.message || "";

  return {
    id: task.id || task.taskId || "",
    status: status,
    title: statusTitle(status),
    desc: statusDesc(status, error),
    images: images,
    error: error,
  };
}

function isDone(status) {
  return ["completed", "succeeded", "success", "failed", "error", "canceled", "cancelled"].indexOf(status) >= 0;
}

function statusTitle(status) {
  if (status === "completed" || status === "succeeded" || status === "success") return "生成完成";
  if (status === "failed" || status === "error") return "生成失败";
  if (status === "canceled" || status === "cancelled") return "任务已取消";
  if (status === "queued" || status === "pending") return "排队中";
  return "生成中";
}

function statusDesc(status, error) {
  if (status === "completed" || status === "succeeded" || status === "success") return "可以预览、保存或继续生成下一组。";
  if (status === "failed" || status === "error") return error || "后端返回失败状态，请查看任务日志。";
  if (status === "canceled" || status === "cancelled") return "任务已经取消，可以返回重新提交。";
  if (status === "queued" || status === "pending") return "任务已经提交，正在等待生成队列处理。";
  return "正在生成图文结果，页面会自动刷新。";
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
    error: "",
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

    api.getGenerationTask(this.data.taskId)
      .then(function (result) {
        var task = normalizeTask(result);
        page.setData({
          loading: false,
          task: task,
          statusTitle: task.title,
          statusDesc: task.desc,
          images: task.images,
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

  saveImage: function (event) {
    var url = event.currentTarget.dataset.url;
    if (!url) return;
    wx.downloadFile({
      url: url,
      success: function (res) {
        if (res.statusCode !== 200) {
          wx.showToast({
            title: "下载失败",
            icon: "none",
          });
          return;
        }
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
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
      },
      fail: function () {
        wx.showToast({
          title: "下载失败",
          icon: "none",
        });
      },
    });
  },

  createAnother: function () {
    wx.redirectTo({
      url: "/pages/generate/index",
    });
  },
});
