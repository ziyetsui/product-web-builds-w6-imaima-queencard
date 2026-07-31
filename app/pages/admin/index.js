var api = require("../../services/api.js");
var admin = require("../../services/admin.js");

Page({
  data: {
    apiReady: api.isConfigured(),
    users: [],
    orders: [],
    audit: [],
    targetUserId: "",
    amount: "",
    reason: "",
    loading: false,
    adding: false,
    error: "",
    notice: "",
  },

  onLoad: function () {
    this.loadAdmin();
  },

  onPullDownRefresh: function () {
    this.loadAdmin().finally(function () {
      wx.stopPullDownRefresh();
    });
  },

  loadAdmin: function () {
    var page = this;
    this.setData({
      apiReady: api.isConfigured(),
      loading: true,
      error: "",
      notice: "",
    });

    if (!api.isConfigured()) {
      this.setData({
        loading: false,
        error: "后端 API 未配置，无法进入管理接口。",
      });
      return Promise.resolve();
    }

    return Promise.all([
      admin.listAdminUsers({ limit: 20 }),
      admin.listAdminOrders({ limit: 20 }),
      admin.listAdminPaymentAudit({ limit: 20 }),
    ])
      .then(function (results) {
        page.setData({
          users: results[0],
          orders: results[1],
          audit: results[2],
          targetUserId: page.data.targetUserId || (results[0][0] && results[0][0].id) || "",
          loading: false,
          error: "",
        });
      })
      .catch(function (error) {
        page.setData({
          loading: false,
          error: error.message || "管理数据读取失败",
        });
      });
  },

  selectUser: function (event) {
    this.setData({
      targetUserId: event.currentTarget.dataset.id || "",
    });
  },

  onTargetInput: function (event) {
    this.setData({
      targetUserId: event.detail.value,
    });
  },

  onAmountInput: function (event) {
    this.setData({
      amount: event.detail.value,
    });
  },

  onReasonInput: function (event) {
    this.setData({
      reason: event.detail.value,
    });
  },

  addCredits: function () {
    var page = this;
    var amount = Number(this.data.amount || 0);
    var reason = String(this.data.reason || "").replace(/^\s+|\s+$/g, "");
    var targetUserId = String(this.data.targetUserId || "").replace(/^\s+|\s+$/g, "");

    if (!targetUserId || !amount || amount <= 0 || !reason) {
      wx.showToast({
        title: "填写用户、金额、原因",
        icon: "none",
      });
      return;
    }

    this.setData({
      adding: true,
      error: "",
      notice: "",
    });

    admin.adminAddCredits({
      userId: targetUserId,
      amount: amount,
      reason: reason,
    })
      .then(function () {
        page.setData({
          adding: false,
          amount: "",
          reason: "",
          notice: "已提交加积分操作。",
        });
        page.loadAdmin();
      })
      .catch(function (error) {
        page.setData({
          adding: false,
          error: error.message || "加积分失败",
        });
      });
  },

  goAccount: function () {
    wx.navigateTo({ url: "/pages/account/index" });
  },
});
