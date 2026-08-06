var landing = require("../../data/landing.js");
var api = require("../../services/api.js");
var auth = require("../../services/auth.js");
var generation = require("../../services/generation.js");
var templatesService = require("../../services/templates.js");
var templatePrompt = require("../../services/template-prompt.js");
var templatePattern = require("../../services/template-pattern.js");

var DEFAULT_MODEL_VALUE = "gpt-image-2-edit";
var DEFAULT_MODEL_LABEL = "GPT Image 2";
var DEFAULT_TEXT_MODEL_VALUE = "gpt-image-2";
var MODE_IMAGE_EDIT = "image-edit";
var MODE_TEXT_TO_IMAGE = "text-to-image";
var MAX_REFERENCE_IMAGES = 3;

function trim(value) {
  return String(value || "").replace(/^\s+|\s+$/g, "");
}

function decodeOption(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return String(value || "");
  }
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

function uniqueImages(images, limit) {
  var seen = {};
  var result = [];
  var i = 0;
  var image = "";
  for (i = 0; i < images.length; i += 1) {
    image = images[i];
    if (!image || seen[image]) continue;
    seen[image] = true;
    result.push(image);
  }
  return result.slice(0, limit || MAX_REFERENCE_IMAGES);
}

function chooseImages(count) {
  return new Promise(function (resolve, reject) {
    var limit = Math.max(1, Math.min(MAX_REFERENCE_IMAGES, count || 1));
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: limit,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: function (res) {
          var files = res.tempFiles || [];
          var paths = files.map(function (file) {
            return file && file.tempFilePath;
          }).filter(Boolean);
          if (!paths.length) {
            reject(new Error("没有选择图片"));
            return;
          }
          resolve(paths);
        },
        fail: function (error) {
          reject(new Error(error.errMsg || "选择图片失败"));
        },
      });
      return;
    }

    wx.chooseImage({
      count: limit,
      sourceType: ["album", "camera"],
      success: function (res) {
        var paths = res.tempFilePaths || [];
        if (!paths.length) {
          reject(new Error("没有选择图片"));
          return;
        }
        resolve(paths);
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
  var fallbackIndex = 0;
  var target = value || DEFAULT_MODEL_VALUE;
  for (i = 0; i < models.length; i += 1) {
    if (models[i].value === DEFAULT_MODEL_VALUE) fallbackIndex = i;
    if (models[i].value === target) return i;
  }
  return fallbackIndex;
}

function modelsForCapability(models, capability) {
  return models.filter(function (model) {
    return model.capability === capability || (model.capabilities && model.capabilities.indexOf(capability) >= 0);
  });
}

function publicModel(record) {
  return {
    label: record.publicLabel || record.label || record.key,
    value: record.key || record.value,
    capability: record.capability || "",
    capabilities: record.capabilities || [],
    referenceLimits: record.referenceLimits || { min: 0, max: MAX_REFERENCE_IMAGES },
    outputLimit: record.outputLimit || 4,
  };
}

function defaultModelForCapability(capability) {
  return capability === MODE_TEXT_TO_IMAGE ? DEFAULT_TEXT_MODEL_VALUE : DEFAULT_MODEL_VALUE;
}

function modeIndexFor(modes, capability) {
  var i = 0;
  for (i = 0; i < modes.length; i += 1) {
    if (modes[i].value === capability) return i;
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
    referenceImagePaths: [],
    referenceAssetIds: [],
    maxReferenceImages: MAX_REFERENCE_IMAGES,
    templateId: "",
    templateTitle: "",
    templatePrompt: "",
    pattern: null,
    patternValues: {},
    patternDefaults: {},
    promptPreview: "",
    fixedPromptMode: false,
    promptSlots: [],
    topic: "",
    prompt: landing.hero.samplePrompt,
    modes: [
      { label: "参考图生成", value: MODE_IMAGE_EDIT },
      { label: "纯文生图", value: MODE_TEXT_TO_IMAGE },
    ],
    modeIndex: 0,
    modeLabel: "参考图生成",
    capability: MODE_IMAGE_EDIT,
    models: [
      { label: DEFAULT_MODEL_LABEL, value: DEFAULT_MODEL_VALUE, capabilities: [MODE_IMAGE_EDIT, MODE_TEXT_TO_IMAGE] },
      { label: "Gemini 3.1 Flash Image Preview", value: "gemini-3.1-flash-image-preview", capabilities: [MODE_IMAGE_EDIT, MODE_TEXT_TO_IMAGE] },
      { label: "Seedream 5.0", value: "seedream-5.0", capabilities: [MODE_IMAGE_EDIT, MODE_TEXT_TO_IMAGE] },
      { label: "Doubao Seedream 5.0", value: "doubao-seedream-5.0", capabilities: [MODE_IMAGE_EDIT, MODE_TEXT_TO_IMAGE] },
      { label: "Vidu Q2", value: "vidu-q2", capabilities: ["image-to-image", MODE_TEXT_TO_IMAGE] }
    ],
    availableModels: [
      { label: DEFAULT_MODEL_LABEL, value: DEFAULT_MODEL_VALUE, capabilities: [MODE_IMAGE_EDIT, MODE_TEXT_TO_IMAGE] },
      { label: "Gemini 3.1 Flash Image Preview", value: "gemini-3.1-flash-image-preview", capabilities: [MODE_IMAGE_EDIT, MODE_TEXT_TO_IMAGE] },
      { label: "Seedream 5.0", value: "seedream-5.0", capabilities: [MODE_IMAGE_EDIT, MODE_TEXT_TO_IMAGE] },
      { label: "Doubao Seedream 5.0", value: "doubao-seedream-5.0", capabilities: [MODE_IMAGE_EDIT, MODE_TEXT_TO_IMAGE] }
    ],
    modelIndex: 0,
    modelLabel: DEFAULT_MODEL_LABEL,
    outputCounts: [1, 2, 4],
    countIndex: 0,
    outputCountLabel: "1 张",
    sourceTaskId: "",
    estimateText: "填写内容后显示预计消耗",
    estimateLoading: false,
    estimateError: "",
    busy: false,
    templateLoading: false,
  },

  onLoad: function (options) {
    var templateId = options && options.templateId ? decodeOption(options.templateId) : "";
    this.prefillFromOptions(options || {});
    if (!templateId) {
      this.setPromptSource(
        decodeOption(options && options.prompt) || landing.hero.samplePrompt,
      );
    }
    this.loadModels();
    if (templateId) {
      this.loadTemplateSeed(templateId);
    } else {
      this.scheduleEstimate();
    }
  },

  loadModels: function () {
    var page = this;
    if (!this.data.apiReady || !api.listImageModels) return;
    api.listImageModels().then(function (payload) {
      var records = (payload && (payload.models || payload.records)) || [];
      var models = records.map(publicModel);
      var current = page.data.models[page.data.modelIndex] || {};
      var available = modelsForCapability(models, page.data.capability);
      if (!models.length || !available.length) return;
      var index = modelIndexFor(available, current.value || DEFAULT_MODEL_VALUE);
      page.setData({
        models: models,
        availableModels: available,
        modelIndex: index,
        modelLabel: available[index].label,
      }, function () {
        page.clampReferencesForModel();
      });
    }).catch(function () {
      // Keep the local fallback while the authoritative registry is unavailable.
    });
  },

  onShow: function () {
    var user = auth.getCurrentUser();
    this.setData({
      apiReady: api.isConfigured(),
      user: user,
      userLabel: userLabel(user),
      userDesc: userDesc(user),
    });
    this.scheduleEstimate();
  },

  onUnload: function () {
    if (this.estimateTimer) {
      clearTimeout(this.estimateTimer);
      this.estimateTimer = null;
    }
  },

  prefillFromOptions: function (options) {
    var updates = {};
    var restoredReferences = generation.restoreReferenceState(options, MAX_REFERENCE_IMAGES);
    var referenceImage = restoredReferences.referenceImagePath;
    var prompt = decodeOption(options.prompt);
    var topic = decodeOption(options.topic);
    var sourceTaskId = decodeOption(options.sourceTaskId);
    var model = decodeOption(options.model);
    var outputCount = Number(decodeOption(options.outputCount));
    var capability = decodeOption(options.capability);
    var allModels = this.data.models;
    var i = 0;
    var modeModels = this.data.availableModels;
    var modelIndex = -1;
    var countIndex = this.data.outputCounts.indexOf(outputCount);

    if (!capability && model) {
      for (i = 0; i < allModels.length; i += 1) {
        if (allModels[i].value === model) {
          capability = allModels[i].capability;
          break;
        }
      }
    }
    if (!capability && referenceImage) capability = MODE_IMAGE_EDIT;
    if (capability) {
      modeModels = modelsForCapability(allModels, capability);
      modelIndex = model ? modelIndexFor(modeModels, model) : modelIndexFor(modeModels, defaultModelForCapability(capability));
      updates.capability = capability;
      updates.modeIndex = modeIndexFor(this.data.modes, capability);
      updates.modeLabel = this.data.modes[updates.modeIndex].label;
      updates.availableModels = modeModels;
      updates.modelIndex = modelIndex >= 0 ? modelIndex : 0;
      updates.modelLabel = modeModels[updates.modelIndex] ? modeModels[updates.modelIndex].label : DEFAULT_MODEL_LABEL;
    } else if (model) {
      modelIndex = modelIndexFor(modeModels, model);
      updates.modelIndex = modelIndex;
      updates.modelLabel = modeModels[modelIndex].label;
    }

    if (restoredReferences.referenceImagePaths.length || restoredReferences.referenceAssetIds.length) {
      updates.referenceImagePath = restoredReferences.referenceImagePath;
      updates.referenceImagePaths = restoredReferences.referenceImagePaths;
      updates.referenceAssetIds = restoredReferences.referenceAssetIds;
    }
    if (prompt) updates.prompt = prompt;
    if (topic) updates.topic = topic;
    if (sourceTaskId) updates.sourceTaskId = sourceTaskId;
    if (countIndex >= 0) {
      updates.countIndex = countIndex;
      updates.outputCountLabel = this.data.outputCounts[countIndex] + " 张";
    }

    if (Object.keys(updates).length > 0) {
      this.setData(updates);
    }
  },

  promptValues: function (slots) {
    var values = {};
    (slots || []).forEach(function (slot) {
      values[slot.key] = slot.value || "";
    });
    return values;
  },

  setPromptSource: function (source, callback, pattern, initialValues) {
    var prompt = String(source || "");
    if (pattern) {
      var patternValues = Object.assign({}, initialValues || {});
      var patternSlots = templatePattern.buildPatternSlots(pattern, patternValues);
      this.setData({
        templatePrompt: prompt,
        pattern: pattern,
        patternValues: patternValues,
        patternDefaults: Object.assign({}, patternValues),
        promptPreview: templatePattern.renderPatternTemplate(pattern, patternValues),
        prompt: templatePattern.compilePatternPrompt(pattern, patternValues),
        promptSlots: patternSlots,
        fixedPromptMode: true,
        topic: patternValues.topic || this.data.topic,
      }, callback);
      return;
    }
    var parsed = templatePrompt.parseTemplatePrompt(prompt);
    var slots = parsed.slots || [];
    var rendered = templatePrompt.renderTemplatePrompt(prompt, this.promptValues(slots));
    this.setData({
      templatePrompt: prompt,
      pattern: null,
      patternValues: {},
      patternDefaults: {},
      promptPreview: rendered,
      prompt: rendered,
      promptSlots: slots,
      fixedPromptMode: parsed.hasEditableSlots,
    }, callback);
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
        var capability = MODE_IMAGE_EDIT;
        var modeModels = modelsForCapability(page.data.models, capability);
        var modelIndex = modelIndexFor(modeModels, DEFAULT_MODEL_VALUE);
        var referenceImages = template.previewImages && template.previewImages.length
          ? template.previewImages
          : (template.referenceImages || []);
        var referenceImage = firstReferenceImage(template);
        var referenceImagePaths = uniqueImages(referenceImages.length ? referenceImages : [referenceImage], MAX_REFERENCE_IMAGES);
        var pattern = templatePattern.getPatternForTemplate(template);
        var patternValues = templatePattern.getSuggestedValues(template, pattern);
        page.setData({
          templateTitle: template.title || "",
          capability: capability,
          modeIndex: modeIndexFor(page.data.modes, capability),
          modeLabel: "参考图生成",
          availableModels: modeModels,
          modelIndex: modelIndex,
          modelLabel: modeModels[modelIndex].label,
          templateLoading: false,
        }, function () {
          page.setData({
            referenceImagePath: referenceImagePaths[0] || "",
            referenceImagePaths: referenceImagePaths,
            referenceAssetIds: [],
          });
          page.setPromptSource(template.prompt || seed.prompt || page.data.prompt, function () {
            page.scheduleEstimate();
          }, pattern, patternValues);
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
        }, function () {
          page.scheduleEstimate();
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
      estimateText: "登录后显示预计消耗",
      estimateLoading: false,
      estimateError: "",
    });
  },

  getReferenceLimit: function () {
    var model = this.data.availableModels[this.data.modelIndex] || {};
    var limit = model.referenceLimits && Number(model.referenceLimits.max);
    return Math.max(1, Math.min(MAX_REFERENCE_IMAGES, limit || MAX_REFERENCE_IMAGES));
  },

  clampReferencesForModel: function () {
    var limit = this.getReferenceLimit();
    var paths = (this.data.referenceImagePaths || []).slice(0, limit);
    var assetIds = (this.data.referenceAssetIds || []).slice(0, limit);
    this.setData({
      maxReferenceImages: limit,
      referenceImagePath: paths[0] || "",
      referenceImagePaths: paths,
      referenceAssetIds: assetIds,
    });
  },

  chooseReference: function () {
    var page = this;
    var current = this.data.referenceImagePaths || [];
    var limit = this.getReferenceLimit();
    var remaining = limit - current.length;

    if (this.data.capability === MODE_TEXT_TO_IMAGE) {
      this.switchModeTo(MODE_IMAGE_EDIT);
    }

    if (remaining <= 0) {
      this.chooseReplacementReference();
      return;
    }

    chooseImages(remaining)
      .then(function (paths) {
        var next = uniqueImages(current.concat(paths), limit);
        page.setData({
          referenceImagePath: next[0] || "",
          referenceImagePaths: next,
          referenceAssetIds: [],
        }, function () {
          page.scheduleEstimate();
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

  chooseReplacementReference: function () {
    var page = this;
    var itemList = (this.data.referenceImagePaths || []).map(function (image, index) {
      return "替换第 " + (index + 1) + " 张";
    });
    wx.showActionSheet({
      itemList: itemList,
      success: function (res) {
        var targetIndex = res.tapIndex;
        chooseImages(1).then(function (paths) {
          var next = page.data.referenceImagePaths.slice();
          var assetIds = (page.data.referenceAssetIds || []).slice();
          next[targetIndex] = paths[0];
          next = uniqueImages(next, page.getReferenceLimit());
          assetIds[targetIndex] = "";
          page.setData({
            referenceImagePath: next[0] || "",
            referenceImagePaths: next,
            referenceAssetIds: assetIds.slice(0, next.length),
          }, function () {
            page.scheduleEstimate();
          });
        }).catch(function (error) {
          if (String(error.message || "").indexOf("cancel") >= 0) return;
          wx.showToast({
            title: "选择失败",
            icon: "none",
          });
        });
      },
    });
  },

  removeReference: function (event) {
    var index = event && event.currentTarget ? Number(event.currentTarget.dataset.index) : -1;
    var next = this.data.referenceImagePaths.slice();
    var assetIds = (this.data.referenceAssetIds || []).slice();
    if (index >= 0) {
      next.splice(index, 1);
      assetIds.splice(index, 1);
    } else {
      next = [];
      assetIds = [];
    }
    this.setData({
      referenceImagePath: next[0] || "",
      referenceImagePaths: next,
      referenceAssetIds: assetIds,
      estimateText: "上传参考图后显示预计消耗",
      estimateLoading: false,
      estimateError: "",
    });
  },

  previewReference: function (event) {
    var current = event && event.currentTarget ? event.currentTarget.dataset.current : "";
    if (!this.data.referenceImagePaths.length) return;
    wx.previewImage({
      current: current || this.data.referenceImagePath,
      urls: this.data.referenceImagePaths,
    });
  },

  onTopicInput: function (event) {
    var value = event.detail.value;
    if (this.data.pattern) {
      var patternValues = Object.assign({}, this.data.patternValues || {}, { topic: value });
      this.setData({
        topic: value,
        patternValues: patternValues,
        promptSlots: templatePattern.buildPatternSlots(this.data.pattern, patternValues),
        promptPreview: templatePattern.renderPatternTemplate(this.data.pattern, patternValues),
        prompt: templatePattern.compilePatternPrompt(this.data.pattern, patternValues),
      });
    } else {
      this.setData({ topic: value });
    }
    this.scheduleEstimate();
  },

  onPromptInput: function (event) {
    var value = event.detail.value;
    this.setData({
      prompt: value,
      templatePrompt: value,
      pattern: null,
      patternValues: {},
      patternDefaults: {},
      promptPreview: value,
      promptSlots: [],
      fixedPromptMode: false,
    });
    this.scheduleEstimate();
  },

  onPromptSlotInput: function (event) {
    var index = Number(event && event.currentTarget && event.currentTarget.dataset.index);
    var value = event && event.detail ? event.detail.value : "";
    if (this.data.pattern) {
      var patternSlot = this.data.promptSlots[index];
      var patternValues = Object.assign({}, this.data.patternValues || {});
      if (patternSlot) patternValues[patternSlot.key] = value;
      var patternSlots = templatePattern.buildPatternSlots(this.data.pattern, patternValues);
      this.setData({
        patternValues: patternValues,
        promptSlots: patternSlots,
        promptPreview: templatePattern.renderPatternTemplate(this.data.pattern, patternValues),
        prompt: templatePattern.compilePatternPrompt(this.data.pattern, patternValues),
        topic: patternValues.topic || this.data.topic,
      });
      this.scheduleEstimate();
      return;
    }
    var slots = (this.data.promptSlots || []).map(function (slot, slotIndex) {
      return slotIndex === index ? Object.assign({}, slot, { value: value }) : slot;
    });
    this.setData({
      promptSlots: slots,
      prompt: templatePrompt.renderTemplatePrompt(this.data.templatePrompt, this.promptValues(slots)),
    });
    this.scheduleEstimate();
  },

  estimatePayload: function () {
    return generation.buildGenerationRequest(this.data);
  },

  scheduleEstimate: function () {
    var page = this;
    if (this.estimateTimer) {
      clearTimeout(this.estimateTimer);
      this.estimateTimer = null;
    }
    this.estimateTimer = setTimeout(function () {
      page.refreshEstimate();
    }, 220);
  },

  refreshEstimate: function () {
    var page = this;
    var payload = this.estimatePayload();

    if (!this.data.apiReady) {
      this.setData({
        estimateText: "连接后端后显示预计消耗",
        estimateLoading: false,
        estimateError: "",
      });
      return;
    }

    if (!auth.getCurrentUser()) {
      this.setData({
        estimateText: "登录后显示预计消耗",
        estimateLoading: false,
        estimateError: "",
      });
      return;
    }

    if (this.data.capability !== MODE_TEXT_TO_IMAGE && !payload.referenceImages.length) {
      this.setData({
        estimateText: "上传参考图后显示预计消耗",
        estimateLoading: false,
        estimateError: "",
      });
      return;
    }

    if (!payload.prompt) {
      this.setData({
        estimateText: "填写生成要求后显示预计消耗",
        estimateLoading: false,
        estimateError: "",
      });
      return;
    }

    this.setData({
      estimateLoading: true,
      estimateError: "",
    });

    generation.estimate(payload)
      .then(function (estimate) {
        var credits = estimate.requestedCredits || payload.outputCount || 1;
        page.setData({
          estimateText: "预计消耗 " + credits + " 积分",
          estimateLoading: false,
          estimateError: "",
        });
      })
      .catch(function (error) {
        page.setData({
          estimateText: "暂时无法计算预计消耗",
          estimateLoading: false,
          estimateError: error.message || "额度预估失败",
        });
      });
  },

  onModelChange: function (event) {
    var index = Number(event.detail.value);
    this.setData({
      modelIndex: index,
      modelLabel: this.data.availableModels[index].label,
    }, function () {
      this.clampReferencesForModel();
      this.scheduleEstimate();
    });
  },

  switchModeTo: function (capability) {
    var modeModels = modelsForCapability(this.data.models, capability);
    var modelIndex = modelIndexFor(modeModels, defaultModelForCapability(capability));
    if (!modeModels.length) return;
    this.setData({
      capability: capability,
      modeIndex: modeIndexFor(this.data.modes, capability),
      modeLabel: capability === MODE_TEXT_TO_IMAGE ? "纯文生图" : "参考图生成",
      availableModels: modeModels,
      modelIndex: modelIndex,
      modelLabel: modeModels[modelIndex].label,
    }, function () {
      this.clampReferencesForModel();
    });
  },

  onModeChange: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    var mode = this.data.modes[index] || this.data.modes[0];
    var page = this;
    this.switchModeTo(mode.value);
    wx.showToast({
      title: mode.value === MODE_TEXT_TO_IMAGE ? "已切换纯文生图" : "已切换参考图生成",
      icon: "none",
    });
    setTimeout(function () {
      page.scheduleEstimate();
    }, 0);
  },

  switchToReferenceAndChoose: function () {
    this.switchModeTo(MODE_IMAGE_EDIT);
    this.chooseReference();
  },

  onCountChange: function (event) {
    var index = Number(event.detail.value);
    this.setData({
      countIndex: index,
      outputCountLabel: this.data.outputCounts[index] + " 张",
    });
    this.scheduleEstimate();
  },

  resetPrompt: function () {
    var pattern = this.data.pattern;
    var defaults = pattern ? this.data.patternDefaults : null;
    this.setPromptSource(this.data.templatePrompt || landing.hero.samplePrompt, function () {
      this.scheduleEstimate();
    }.bind(this), pattern, defaults);
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
    var capability = this.data.capability;
    var referenceImagePaths = capability === MODE_TEXT_TO_IMAGE ? [] : (this.data.referenceImagePaths || []);
    var referenceAssetIds = capability === MODE_TEXT_TO_IMAGE ? [] : (this.data.referenceAssetIds || []);
    var referenceCount = Math.max(referenceImagePaths.length, referenceAssetIds.length);
    var referenceLimit = this.getReferenceLimit();

    if (!this.data.apiReady) {
      this.showBackendNotice();
      return;
    }

    if (capability !== MODE_TEXT_TO_IMAGE && referenceCount === 0) {
      wx.showToast({
        title: "先上传参考图",
        icon: "none",
      });
      return;
    }

    if (capability !== MODE_TEXT_TO_IMAGE && referenceCount > referenceLimit) {
      wx.showToast({
        title: "参考图数量超过当前模型限制",
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

    if (this.data.fixedPromptMode && (this.data.promptSlots || []).some(function (slot) {
      return !trim(slot.value);
    })) {
      wx.showToast({
        title: "请填写全部词槽",
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
        return Promise.all(referenceImagePaths.map(function (referenceImagePath, index) {
          if (isRemoteUrl(referenceImagePath)) {
            return Promise.resolve({ url: referenceImagePath, assetId: page.data.referenceAssetIds[index] || "" });
          }
          return generation.uploadReferenceImage(referenceImagePath);
        }));
      })
      .then(function (uploads) {
        var request = generation.buildGenerationRequest(page.data, uploads);
        if (capability !== MODE_TEXT_TO_IMAGE && !request.referenceImages.length && !request.referenceAssetIds.length) {
          throw new Error("上传成功但没有返回可用的参考图");
        }
        page.setData({ referenceAssetIds: request.referenceAssetIds });
        return generation.createTask(request);
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
