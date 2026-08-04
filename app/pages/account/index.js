var api = require("../../services/api.js");
var account = require("../../services/account.js");
var auth = require("../../services/auth.js");
var credits = require("../../services/credits.js");

function userLabel(user) {
  if (!user) return "未登录";
  return user.nickname || user.nickName || user.name || user.email || user.id || "已登录账号";
}

Page({
  data: {
    apiReady: api.isConfigured(),
    user: null,
    userName: "未登录",
    userRole: "点击同步微信资料登录",
    nickname: "",
    balance: 0,
    loading: false,
    saving: false,
    loggingIn: false,
    authRequired: false,
    error: "",
  },

  onLoad: function (options) {
    if (options && options.auth === "required") {
      this.setData({
        authRequired: true,
        loading: false,
        error: "登录已失效，请重新登录",
      });
      return;
    }
    this.loadAccount();
  },

  onShow: function () {
    if (this.data.authRequired) return;
    this.loadBalance();
  },

  loadAccount: function () {
    var page = this;
    var localUser = auth.getCurrentUser();
    this.setData({
      apiReady: api.isConfigured(),
      user: localUser,
      userName: userLabel(localUser),
      userRole: localUser ? "user" : "点击同步微信资料登录",
      nickname: userLabel(localUser) === "未登录" ? "" : userLabel(localUser),
      loading: true,
      error: "",
    });

    if (!api.isConfigured()) {
      this.setData({
        loading: false,
        error: "后端 API 未配置，暂时只能查看本地登录缓存。",
      });
      return;
    }

    Promise.all([account.getMe(), credits.getBalance().catch(function () { return { balance: 0 }; })])
      .then(function (results) {
        var user = results[0];
        page.setData({
          user: user,
          userName: userLabel(user),
          userRole: user.isAdmin ? "admin" : "user",
          nickname: user.nickname || userLabel(user),
          balance: Number(results[1].balance || 0),
          loading: false,
          error: "",
        });
      })
      .catch(function (error) {
        page.setData({
          loading: false,
          error: error.message || "账号读取失败",
        });
      });
  },

  loadBalance: function () {
    var page = this;
    if (!api.isConfigured()) return;
    credits.getBalance()
      .then(function (result) {
        page.setData({
          balance: Number(result.balance || 0),
        });
      })
      .catch(function () {});
  },

  onNicknameInput: function (event) {
    this.setData({
      nickname: event.detail.value,
    });
  },

  loginWithWechat: function () {
    var page = this;
    var getProfile = wx.getUserProfile
      ? new Promise(function (resolve, reject) {
          wx.getUserProfile({
            desc: "用于显示小程序账号头像和昵称",
            success: function (res) {
              resolve(res.userInfo || {});
            },
            fail: reject,
          });
        })
      : Promise.resolve({});

    this.setData({
      loggingIn: true,
      error: "",
    });

    getProfile
      .then(function (profile) {
        return auth.loginWithWechatProfile(profile);
      })
      .then(function () {
        page.setData({
          loggingIn: false,
          authRequired: false,
        });
        page.loadAccount();
      })
      .catch(function (error) {
        page.setData({
          loggingIn: false,
          error: error.errMsg || error.message || "微信登录失败",
        });
      });
  },

  saveNickname: function () {
    var page = this;
    var nickname = String(this.data.nickname || "").replace(/^\s+|\s+$/g, "");
    if (!nickname) {
      wx.showToast({
        title: "请填写昵称",
        icon: "none",
      });
      return;
    }
    if (nickname.length > 40) {
      wx.showToast({
        title: "昵称最多40个字",
        icon: "none",
      });
      return;
    }
    if (!api.isConfigured()) return;

    this.setData({
      saving: true,
      error: "",
    });

    account.patchAccountMe({
      nickname: nickname,
      name: nickname,
    })
      .then(function (user) {
        page.setData({
          user: user,
          userName: userLabel(user),
          userRole: user.isAdmin ? "admin" : "user",
          nickname: user.nickname || nickname,
          saving: false,
        });
        wx.showToast({
          title: "已更新",
          icon: "success",
        });
      })
      .catch(function (error) {
        page.setData({
          saving: false,
          error: error.message || "保存失败",
        });
      });
  },

  logout: function () {
    var page = this;
    auth.logout().then(function () {
      page.setData({
        user: null,
        userName: "未登录",
        userRole: "点击同步微信资料登录",
        nickname: "",
        balance: 0,
        error: "",
      });
      wx.showToast({
        title: "已退出",
        icon: "success",
      });
    });
  },

  goCredits: function () {
    wx.navigateTo({ url: "/pages/credits/index" });
  },

  goHistory: function () {
    wx.navigateTo({ url: "/pages/history/index" });
  },

  goBilling: function () {
    wx.navigateTo({ url: "/pages/billing/index" });
  },

  goPricing: function () {
    wx.navigateTo({ url: "/pages/pricing/index" });
  },

  goAdmin: function () {
    wx.navigateTo({ url: "/pages/admin/index" });
  },
});
