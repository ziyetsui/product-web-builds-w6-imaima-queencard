var landing = require("../../data/landing.js");
var api = require("../../services/api.js");
var auth = require("../../services/auth.js");
var templatesService = require("../../services/templates.js");

function trim(value) {
  return String(value || "").replace(/^\s+|\s+$/g, "");
}

function isRemoteUrl(value) {
  return /^https:\/\//.test(String(value || ""));
}

function firstReferenceImage(template) {
  if (!template) return "";
  if (template.previewUrl) return template.previewUrl;
  if (template.thumbnailUrl) return template.thumbnailUrl;
  if (template.referenceImages && template.referenceImages[0]) return template.referenceImages[0];
  return "";
}

function chooseOneImage() {
  return new Promise(function (resolve, reject) {
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: function (res) {
          var file = res.tempFiles && res.tempFiles[0];
          if (!file || !file.tempFilePath) {
            reject(new Error("没有选择图片"));
            return;
          }
          resolve(file.tempFilePath);
        },
        fail: function (error) {
          reject(new Error(error.errMsg || "选择图片失败"));
        },
      });
      return;
    }

    wx.chooseImage({
      count: 1,
      sourceType: ["album", "camera"],
      success: function (res) {
        var filePath = res.tempFilePaths && res.tempFilePaths[0];
        if (!filePath) {
          reject(new Error("没有选择图片"));
          return;
        }
        resolve(filePath);
      },
      fail: function (error) {
        reject(new Error(error.errMsg || "选择图片失败"));
      },
    });
  });
}

function taskIdFrom(result) {
  if (!result) return "";
  if (result.taskId) return result.taskId;
  if (result.id) return result.id;
  if (result.generationTaskId) return result.generationTaskId;
  if (result.task && result.task.id) return result.task.id;
  if (result.data && result.data.taskId) return result.data.taskId;
  if (result.redirectUrl) {
    var match = String(result.redirectUrl).match(/[?&]taskId=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }
  return "";
}

function userLabel(user) {
  if (!user) return "未登录";
  return user.name || user.email || user.id || "已登录账号";
}

function userDesc(user) {
  if (!user) return "使用 wx.login 获取 code，服务端换 openid 并绑定账号";
  return "后端会把该微信身份映射到独立小程序账号";
}

function modelIndexFor(models, value) {
  var i = 0;
  if (!value) return 0;
  for (i = 0; i < models.length; i += 1) {
    if (models[i].value === value) return i;
  }
  return 0;
}

Page({
  data: {
    apiReady: api.isConfigured(),
    user: null,
    userLabel: "未登录",
    userDesc: "使用 wx.login 获取 code，服务端换 openid 并绑定账号",
    referenceImagePath: "",
    templateId: "",
    templateTitle: "",
    topic: "",
    prompt: landing.hero.samplePrompt,
    models: [
      { label: "Doubao Seedream", value: "doubao-seedream-5-edit" },
      { label: "Seedream", value: "seedream-5-edit" },
      { label: "GPT Image", value: "gpt-image-2-edit" },
      { label: "Gemini Flash", value: "gemini-3.1-flash-edit" }
    ],
    modelIndex: 0,
    modelLabel: "Doubao Seedream",
    outputCounts: [1, 2, 4],
    countIndex: 0,
    outputCountLabel: "1 张",
    busy: false,
    templateLoading: false,
  },

  onLoad: function (options) {
    var templateId = options && options.templateId ? decodeURIComponent(options.templateId) : "";
    if (templateId) {
      this.loadTemplateSeed(templateId);
    }
  },

  onShow: function () {
    var user = auth.getCurrentUser();
    this.setData({
      apiReady: api.isConfigured(),
      user: user,
      userLabel: userLabel(user),
      userDesc: userDesc(user),
    });
  },

  loadTemplateSeed: function (templateId) {
    var page = this;
    if (!this.data.apiReady) {
      this.showBackendNotice();
      return;
    }
    this.setData({
      templateId: templateId,
      templateLoading: true,
    });

    templatesService.getTemplate(templateId)
      .then(function (template) {
        var seed = template.seed || {};
        var modelIndex = modelIndexFor(page.data.models, seed.model);
        page.setData({
          templateTitle: template.title || "",
          referenceImagePath: firstReferenceImage(template),
          prompt: template.prompt || seed.prompt || page.data.prompt,
          modelIndex: modelIndex,
          modelLabel: page.data.models[modelIndex].label,
          templateLoading: false,
        });
      })
      .catch(function (error) {
        page.setData({ templateLoading: false });
        wx.showModal({
          title: "模板加载失败",
          content: error.message || "请返回重试",
          showCancel: false,
        });
      });
  },

  goHome: function () {
    wx.navigateBack({
      delta: 1,
    });
  },

  showBackendNotice: function () {
    wx.showModal({
      title: "还差后端桥接",
      content: "小程序页面已经接好登录、上传和任务提交入口。要真实生成，请先在 config/env.js 配置独立后端的 API_BASE_URL。",
      confirmText: "知道了",
      showCancel: false,
    });
  },

  handleLogin: function () {
    var page = this;
    if (!this.data.apiReady) {
      this.showBackendNotice();
      return;
    }

    this.setData({ busy: true });
    auth.loginWithWechatProfile({ source: "miniapp" })
      .then(function (result) {
        var user = result.user || auth.getCurrentUser();
        page.setData({
          user: user,
          userLabel: userLabel(user),
          userDesc: userDesc(user),
          busy: false,
        });
        wx.showToast({
          title: "已登录",
          icon: "success",
        });
      })
      .catch(function (error) {
        page.setData({ busy: false });
        wx.showModal({
          title: "登录失败",
          content: error.message || "请稍后再试",
          showCancel: false,
        });
      });
  },

  handleLogout: function () {
    auth.logout();
    this.setData({
      user: null,
      userLabel: userLabel(null),
      userDesc: userDesc(null),
    });
  },

  chooseReference: function () {
    var page = this;
    chooseOneImage()
      .then(function (filePath) {
        page.setData({
          referenceImagePath: filePath,
        });
      })
      .catch(function (error) {
        if (String(error.message || "").indexOf("cancel") >= 0) return;
        wx.showToast({
          title: "选择失败",
          icon: "none",
        });
      });
  },

  removeReference: function () {
    this.setData({
      referenceImagePath: "",
    });
  },

  previewReference: function () {
    if (!this.data.referenceImagePath) return;
    wx.previewImage({
      current: this.data.referenceImagePath,
      urls: [this.data.referenceImagePath],
    });
  },

  onTopicInput: function (event) {
    this.setData({
      topic: event.detail.value,
    });
  },

  onPromptInput: function (event) {
    this.setData({
      prompt: event.detail.value,
    });
  },

  onModelChange: function (event) {
    var index = Number(event.detail.value);
    this.setData({
      modelIndex: index,
      modelLabel: this.data.models[index].label,
    });
  },

  onCountChange: function (event) {
    var index = Number(event.detail.value);
    this.setData({
      countIndex: index,
      outputCountLabel: this.data.outputCounts[index] + " 张",
    });
  },

  resetPrompt: function () {
    this.setData({
      prompt: landing.hero.samplePrompt,
    });
  },

  ensureLogin: function () {
    if (auth.getCurrentUser()) {
      return Promise.resolve(auth.getCurrentUser());
    }
    return auth.loginWithWechatProfile({ source: "miniapp" }).then(function (result) {
      return result.user || auth.getCurrentUser();
    });
  },

  submitGeneration: function () {
    var page = this;
    var prompt = trim(this.data.prompt);
    var topic = trim(this.data.topic);
    var referenceImagePath = this.data.referenceImagePath;
    var model = this.data.models[this.data.modelIndex];
    var outputCount = this.data.outputCounts[this.data.countIndex];

    if (!this.data.apiReady) {
      this.showBackendNotice();
      return;
    }

    if (!referenceImagePath) {
      wx.showToast({
        title: "先上传参考图",
        icon: "none",
      });
      return;
    }

    if (!prompt) {
      wx.showToast({
        title: "先填写生成要求",
        icon: "none",
      });
      return;
    }

    if (this.data.busy) return;
    this.setData({ busy: true });

    this.ensureLogin()
      .then(function (user) {
        var currentUser = user || auth.getCurrentUser();
        page.setData({
          user: currentUser,
          userLabel: userLabel(currentUser),
          userDesc: userDesc(currentUser),
        });
        if (isRemoteUrl(referenceImagePath)) {
          return Promise.resolve({ url: referenceImagePath });
        }
        return api.uploadReferenceImage(referenceImagePath);
      })
      .then(function (upload) {
        var referenceUrl = upload.url || upload.fileUrl || upload.assetUrl || upload.key || upload.path;
        if (!referenceUrl) {
          throw new Error("上传成功但没有返回图片 URL");
        }
        return api.createGenerationTask({
          source: "wechat-miniapp",
          model: model.value,
          capability: "image-edit",
          prompt: topic ? prompt + "\n\n我的主题：" + topic : prompt,
          topic: topic,
          templateId: page.data.templateId,
          referenceImages: [referenceUrl],
          outputCount: outputCount,
          aspectRatio: "3:4",
          resolution: "1k",
        });
      })
      .then(function (result) {
        var taskId = taskIdFrom(result);
        page.setData({ busy: false });
        if (!taskId) {
          wx.showModal({
            title: "任务已提交",
            content: "后端没有返回 taskId，请检查 /api/miniapp/image-generations 的响应格式。",
            showCancel: false,
          });
          return;
        }
        wx.navigateTo({
          url: "/pages/result/index?taskId=" + encodeURIComponent(taskId),
        });
      })
      .catch(function (error) {
        page.setData({ busy: false });
        wx.showModal({
          title: "提交失败",
          content: error.message || "请稍后再试",
          showCancel: false,
        });
      });
  },
});
