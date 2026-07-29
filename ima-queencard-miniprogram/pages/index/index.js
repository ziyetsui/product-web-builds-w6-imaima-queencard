var landing = require("../../data/landing.js");
var api = require("../../services/api.js");
var templatesService = require("../../services/templates.js");

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

Page({
  data: {
    landing: landing,
    apiReady: api.isConfigured(),
    templateReady: api.isConfigured() || templatesService.isConfigured(),
    templates: [],
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

  loadTemplates: function (reset) {
    var page = this;
    var nextPage = reset ? 1 : this.data.templatePage;
    if (!this.data.templateReady) {
      this.setData({
        templateError: "模板 API 未配置，暂时显示 landing 静态内容。",
      });
      return Promise.resolve();
    }
    if (this.data.templateLoading) return Promise.resolve();
    if (!reset && !this.data.templateHasMore) return Promise.resolve();

    this.setData({
      templateLoading: true,
      templateError: "",
    });

    return templatesService.listTemplates({
      page: nextPage,
      limit: this.data.templateLimit,
      category: "image",
      language: "zh",
    }).then(function (result) {
      var records = result.records || [];
      var pagination = result.pagination || {};
      var totalPages = pagination.totalPages || pagination.total_pages || nextPage;
      page.setData({
        templates: reset ? records : appendTemplates(page.data.templates, records),
        templatePage: nextPage + 1,
        templateHasMore: nextPage < totalPages || records.length >= page.data.templateLimit,
        templateLoading: false,
        templateError: "",
      });
    }).catch(function (error) {
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
