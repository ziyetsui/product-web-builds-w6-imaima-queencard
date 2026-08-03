var landing = require("../../data/landing.js");
var api = require("../../services/api.js");
var templatesService = require("../../services/templates.js");

var TEMPLATE_CATEGORIES = [
  { label: "全部", key: "all", value: "image", scenarioCategory: "" },
  { label: "热门高赞", key: "hot", value: "image", scenarioCategory: "", hotOnly: true },
  { label: "爆款图文", key: "viral", value: "image", scenarioCategory: "爆款图文" },
  { label: "梗图", key: "meme", value: "image", scenarioCategory: "梗图" },
  { label: "公众号配图", key: "wechat", value: "image", scenarioCategory: "公众号配图" },
  { label: "养生", key: "wellness", value: "image", scenarioCategory: "养生内调" },
  { label: "清单", key: "list", value: "image", scenarioCategory: "清单种草" },
  { label: "图集", key: "gallery", value: "image", scenarioCategory: "美女图集" },
  { label: "情绪", key: "mood", value: "image", scenarioCategory: "情绪疗愈" },
  { label: "漫画", key: "comic", value: "image", scenarioCategory: "搞笑漫画" },
  { label: "自律", key: "growth", value: "image", scenarioCategory: "成长自律" },
  { label: "科普", key: "knowledge", value: "image", scenarioCategory: "知识科普" },
];

var TEMPLATE_SORT_OPTIONS = [
  { label: "默认", value: "default" },
  { label: "最新", value: "latest" },
  { label: "热门", value: "hot" },
  { label: "潜力", value: "potential" },
];

function appendTemplates(current, next) {
  var seen = {};
  var result = [];
  var i = 0;
  for (i = 0; i < current.length; i += 1) {
    if (!current[i] || !current[i].id || seen[current[i].id]) continue;
    seen[current[i].id] = true;
    result.push(current[i]);
  }
  for (i = 0; i < next.length; i += 1) {
    if (!next[i] || !next[i].id || seen[next[i].id]) continue;
    seen[next[i].id] = true;
    result.push(next[i]);
  }
  return result;
}

function markCategoryOptions(selectedKey) {
  return TEMPLATE_CATEGORIES.map(function (item) {
    return {
      label: item.label,
      key: item.key,
      value: item.value,
      scenarioCategory: item.scenarioCategory,
      hotOnly: item.hotOnly || false,
      active: item.key === selectedKey,
    };
  });
}

function markServerCategoryOptions(categories, specialFilters, selectedKey, selectedScenarioCategory, selectedHotOnly) {
  var options = [{
    label: "全部",
    key: "all",
    value: "image",
    scenarioCategory: "",
    hotOnly: false,
  }];
  (categories || []).forEach(function (item, index) {
    var value = item.value || item.label || "";
    if (!value) return;
    options.push({
      label: (item.label || value) + " " + String(item.count == null ? "" : item.count),
      key: "server-category-" + index,
      value: "image",
      scenarioCategory: value,
      hotOnly: false,
    });
  });
  options.push({
    label: ((specialFilters && specialFilters[0] && specialFilters[0].label) || "热门高赞") + " "
      + String(specialFilters && specialFilters[0] && specialFilters[0].count != null ? specialFilters[0].count : ""),
    key: "hot",
    value: "image",
    scenarioCategory: "",
    hotOnly: true,
  });
  return options.map(function (item) {
    var active = item.key === selectedKey
      || (item.scenarioCategory && item.scenarioCategory === selectedScenarioCategory)
      || (item.hotOnly && selectedHotOnly);
    return Object.assign({}, item, { active: active });
  });
}

function markSortOptions(selectedSort) {
  return TEMPLATE_SORT_OPTIONS.map(function (item) {
    return {
      label: item.label,
      value: item.value,
      active: item.value === selectedSort,
    };
  });
}

function cleanText(value) {
  return String(value || "").replace(/^\s+|\s+$/g, "");
}

Page({
  data: {
    landing: landing,
    apiReady: api.isConfigured(),
    templateReady: api.isConfigured() || templatesService.isConfigured(),
    templateSearch: "",
    templateCategoryKey: "all",
    templateCategory: "image",
    templateScenarioCategory: "",
    templateHotOnly: false,
    templateSort: "default",
    templateCategories: markCategoryOptions("all"),
    templateSortOptions: markSortOptions("default"),
    templates: [],
    catalogVersion: "",
    templateCursor: "",
    templatePage: 1,
    templateLimit: 12,
    templateHasMore: true,
    templateLoading: false,
    templateError: "",
  },

  onLoad: function () {
    if (this.data.templateReady) {
      this.loadTemplates(true);
    }
  },

  onUnload: function () {
    if (this.templateSearchTimer) {
      clearTimeout(this.templateSearchTimer);
      this.templateSearchTimer = null;
    }
    this.templateRequestSerial = (this.templateRequestSerial || 0) + 1;
    templatesService.cancelPending();
  },

  onReachBottom: function () {
    this.loadTemplates(false);
  },

  onPullDownRefresh: function () {
    this.loadTemplates(true).finally(function () {
      wx.stopPullDownRefresh();
    });
  },

  openGenerate: function () {
    wx.navigateTo({
      url: "/pages/generate/index",
    });
  },

  openHistory: function () {
    wx.navigateTo({
      url: "/pages/history/index",
    });
  },

  openCredits: function () {
    wx.navigateTo({
      url: "/pages/credits/index",
    });
  },

  openAccount: function () {
    wx.navigateTo({
      url: "/pages/account/index",
    });
  },

  copyPrompt: function () {
    wx.setClipboardData({
      data: this.data.landing.hero.samplePrompt,
      success: function () {
        wx.showToast({
          title: "提示语已复制",
          icon: "success",
        });
      },
    });
  },

  scrollToGallery: function () {
    wx.createSelectorQuery()
      .select("#gallery")
      .boundingClientRect()
      .selectViewport()
      .scrollOffset()
      .exec(function (result) {
        var target = result[0];
        var viewport = result[1];
        if (!target || !viewport) return;
        wx.pageScrollTo({
          scrollTop: viewport.scrollTop + target.top - 12,
          duration: 320,
        });
      });
  },

  scrollToTemplates: function () {
    wx.createSelectorQuery()
      .select("#templates")
      .boundingClientRect()
      .selectViewport()
      .scrollOffset()
      .exec(function (result) {
        var target = result[0];
        var viewport = result[1];
        if (!target || !viewport) return;
        wx.pageScrollTo({
          scrollTop: viewport.scrollTop + target.top - 12,
          duration: 320,
        });
      });
  },

  showBackendNotice: function () {
    wx.showModal({
      title: "后端还未配置",
      content: "动态模板和真实生成需要把 config/env.js 的 API_BASE_URL 指向独立小程序后端。",
      confirmText: "知道了",
      showCancel: false,
    });
  },

  refreshTemplates: function () {
    return this.loadTemplates(true);
  },

  onTemplateSearchInput: function (event) {
    var page = this;
    var value = event && event.detail ? event.detail.value : "";
    this.setData({
      templateSearch: value,
      templatePage: 1,
      templateCursor: "",
      templateHasMore: true,
    });
    if (this.templateSearchTimer) {
      clearTimeout(this.templateSearchTimer);
    }
    this.templateSearchTimer = setTimeout(function () {
      page.loadTemplates(true);
    }, 280);
  },

  onTemplateSearchConfirm: function () {
    if (this.templateSearchTimer) {
      clearTimeout(this.templateSearchTimer);
      this.templateSearchTimer = null;
    }
    this.loadTemplates(true);
  },

  selectTemplateCategory: function (event) {
    var key = event.currentTarget.dataset.key || "all";
    var category = event.currentTarget.dataset.value || "";
    var scenarioCategory = event.currentTarget.dataset.scenarioCategory || "";
    var hotOnlyValue = event.currentTarget.dataset.hotOnly;
    var hotOnly = hotOnlyValue === true || hotOnlyValue === "true" || hotOnlyValue === "1";
    if (key === this.data.templateCategoryKey) return;
    this.setData({
      templateCategoryKey: key,
      templateCategory: category,
      templateScenarioCategory: scenarioCategory,
      templateHotOnly: hotOnly,
      templateCategories: markCategoryOptions(key),
      templatePage: 1,
      templateCursor: "",
      templateHasMore: true,
    });
    this.loadTemplates(true);
  },

  selectTemplateSort: function (event) {
    var sort = event.currentTarget.dataset.value || "default";
    if (sort === this.data.templateSort) return;
    this.setData({
      templateSort: sort,
      templateSortOptions: markSortOptions(sort),
      templatePage: 1,
      templateHasMore: true,
    });
    this.loadTemplates(true);
  },

  loadTemplates: function (reset) {
    var page = this;
    if (reset) templatesService.cancelPending();
    var requestSerial = (this.templateRequestSerial || 0) + 1;
    this.templateRequestSerial = requestSerial;
    var nextPage = reset ? 1 : this.data.templatePage;
    var query = cleanText(this.data.templateSearch);
    if (!this.data.templateReady) {
      this.setData({
        templateError: "模板 API 未配置，暂时显示 landing 静态内容。",
      });
      return Promise.resolve();
    }
    if (this.data.templateLoading && !reset) return Promise.resolve();
    if (!reset && !this.data.templateHasMore) return Promise.resolve();

    this.setData({
      templateLoading: true,
      templateError: "",
    });

    return templatesService.listTemplates({
      page: nextPage,
      limit: this.data.templateLimit,
      q: query,
      category: this.data.templateCategory,
      scenarioCategory: this.data.templateScenarioCategory,
      hotOnly: this.data.templateHotOnly,
      sort: this.data.templateSort,
      cursor: reset ? "" : this.data.templateCursor,
      language: "zh",
    }).then(function (result) {
      if (requestSerial !== page.templateRequestSerial) return;
      var records = result.records || [];
      var pagination = result.pagination || {};
      var totalPages = pagination.totalPages || pagination.total_pages || nextPage;
      page.setData({
        templates: reset ? records : appendTemplates(page.data.templates, records),
        templatePage: nextPage + 1,
        templateCursor: pagination.nextCursor || "",
        templateHasMore: pagination.hasMore !== undefined ? Boolean(pagination.hasMore) : nextPage < totalPages || records.length >= page.data.templateLimit,
        catalogVersion: result.catalogVersion || page.data.catalogVersion,
        templateCategories: result.categories && result.categories.length
          ? markServerCategoryOptions(
            result.categories,
            result.specialFilters,
            page.data.templateCategoryKey,
            page.data.templateScenarioCategory,
            page.data.templateHotOnly,
          )
          : page.data.templateCategories,
        templateLoading: false,
        templateError: "",
      });
    }).catch(function (error) {
      if (error && error.stale) return;
      if (requestSerial !== page.templateRequestSerial) return;
      page.setData({
        templateLoading: false,
        templateError: error.message || "模板加载失败",
      });
    });
  },

  generateTemplate: function (event) {
    var id = event.currentTarget.dataset.id;
    if (!id) return;
    if (!this.data.apiReady) {
      wx.showModal({
        title: "当前只能看模板",
        content: "当前需要独立后端提供账号、额度和生成接口，不能只放在小程序前端里。",
        confirmText: "知道了",
        showCancel: false,
      });
      return;
    }
    wx.navigateTo({
      url: "/pages/generate/index?templateId=" + encodeURIComponent(id),
    });
  },

  previewCase: function (event) {
    var current = event.currentTarget.dataset.current;
    var urls = event.currentTarget.dataset.urls;
    if (!current || !urls) return;
    wx.previewImage({
      current: current,
      urls: urls,
    });
  },

  showTryNotice: function () {
    this.scrollToTemplates();
  },
});
