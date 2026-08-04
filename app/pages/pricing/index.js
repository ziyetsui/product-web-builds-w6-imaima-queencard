var api = require("../../services/api.js");
var billing = require("../../services/billing.js");
var credits = require("../../services/credits.js");

var FALLBACK_PACKS = [
  {
    id: "credits_20",
    name: "20 次创作包",
    credits: 20,
    price: "¥19",
    accent: "lemon",
    desc: "适合轻量体验。",
  },
  {
    id: "credits_60",
    name: "60 次创作包",
    credits: 60,
    price: "¥49",
    accent: "seafoam",
    desc: "热门选择。",
  },
  {
    id: "credits_160",
    name: "160 次创作包",
    credits: 160,
    price: "¥99",
    accent: "pumpkin",
    desc: "适合高频创作者。",
  },
];

function requestPayment(params) {
  return new Promise(function (resolve, reject) {
    wx.requestPayment({
      timeStamp: String(params.timeStamp || params.timestamp || ""),
      nonceStr: params.nonceStr || params.nonce_str || "",
      package: params.package || params.packageValue || "",
      signType: params.signType || params.sign_type || "RSA",
      paySign: params.paySign || params.pay_sign || "",
      success: resolve,
      fail: reject,
    });
  });
}

Page({
  data: {
    apiReady: api.isConfigured(),
    packs: [],
    balance: 0,
    loading: false,
    payingProductId: "",
    error: "",
    notice: "",
  },

  onLoad: function () {
    this.loadPage();
  },

  onShow: function () {
    this.refreshCredits();
  },

  loadPage: function () {
    var page = this;
    this.setData({
      apiReady: api.isConfigured(),
      loading: true,
      error: "",
      notice: "",
    });

    if (!api.isConfigured()) {
      this.setData({
        packs: FALLBACK_PACKS,
        loading: false,
        error: "后端 API 未配置，当前只能查看本地套餐样式。",
      });
      return;
    }

    Promise.all([
      billing.listPricingProducts(),
      credits.getBalance().catch(function () {
        return { balance: 0 };
      }),
    ])
      .then(function (results) {
        var products = results[0];
        var balance = results[1];
        page.setData({
          packs: products.length ? products : FALLBACK_PACKS,
          balance: Number(balance.balance || 0),
          loading: false,
          error: "",
        });
      })
      .catch(function (error) {
        page.setData({
          packs: FALLBACK_PACKS,
          loading: false,
          error: error.message || "套餐加载失败，已显示本地兜底套餐。",
        });
      });
  },

  refreshCredits: function () {
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

  completeOrder: function (order, message) {
    var page = this;
    this.refreshCredits();
    this.setData({
      payingProductId: "",
      notice: message || "订单已完成，积分正在同步。",
    });
    wx.showModal({
      title: "订单完成",
      content: message || "订单已完成，积分会自动刷新。",
      confirmText: "查看订单",
      cancelText: "留在本页",
      success: function (res) {
        if (res.confirm) {
          wx.navigateTo({
            url: "/pages/billing/index?orderId=" + encodeURIComponent(order.id || ""),
            fail: function () {
              page.loadPage();
            },
          });
        }
      },
    });
  },

  waitForOrder: function (orderId, attempt) {
    var page = this;
    var currentAttempt = attempt || 0;
    return billing.getOrder(orderId).then(function (latest) {
      var paymentStatus = String(latest.paymentStatus || "").toLowerCase();
      var status = String(latest.status || "").toLowerCase();
      if (paymentStatus === "fulfilled" || status === "paid") return latest;
      if (["failed", "canceled", "refunded"].indexOf(paymentStatus) >= 0 || ["failed", "canceled", "refunded"].indexOf(status) >= 0) {
        throw new Error("订单状态为" + (latest.status || latest.paymentStatus));
      }
      if (currentAttempt >= 10) {
        throw new Error("支付已提交，积分仍在同步，请稍后到订单页查看。");
      }
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve(page.waitForOrder(orderId, currentAttempt + 1));
        }, 1500);
      });
    });
  },

  offerMockPay: function (order) {
    var page = this;
    wx.showModal({
      title: "开发支付完成",
      content: "后端没有返回 paymentParams。可调用 mock-pay 接口把这笔订单标记为已支付。",
      confirmText: "mock 完成",
      cancelText: "稍后处理",
      success: function (res) {
        if (!res.confirm) {
          page.setData({
            payingProductId: "",
            notice: "订单已创建，可稍后在订单页继续处理。",
          });
          return;
        }
        billing.mockPayOrder(order.id)
          .then(function (result) {
            page.completeOrder(result.order || order, "mock-pay 已完成，积分已刷新。");
          })
          .catch(function (error) {
            page.setData({
              payingProductId: "",
              error: error.message || "mock-pay 失败",
            });
          });
      },
    });
  },

  choosePack: function (event) {
    var page = this;
    var productId = event.currentTarget.dataset.id;
    if (!productId || this.data.payingProductId) return;
    if (!api.isConfigured()) {
      wx.showModal({
        title: "后端未配置",
        content: "需要 /api/miniapp/pricing 和 /api/miniapp/orders 才能创建支付订单。",
        showCancel: false,
      });
      return;
    }

    this.setData({
      payingProductId: productId,
      error: "",
      notice: "",
    });

    billing.createOrder(productId, "wechat")
      .then(function (result) {
        var order = result.order || {};
        if (!order.id) {
          throw new Error("后端没有返回订单 ID");
        }
        if (!result.paymentParams) {
          page.offerMockPay(order);
          return;
        }
        requestPayment(result.paymentParams)
          .then(function () {
            page.waitForOrder(order.id)
              .then(function (latest) {
                page.completeOrder(latest || order, "微信支付已完成，积分已刷新。");
              })
              .catch(function (error) {
                page.setData({
                  payingProductId: "",
                  notice: error.message || "支付已提交，请稍后查看订单状态。",
                  error: "",
                });
                page.refreshCredits();
              });
          })
          .catch(function (error) {
            page.setData({
              payingProductId: "",
              error: error.errMsg || error.message || "支付未完成",
            });
          });
      })
      .catch(function (error) {
        page.setData({
          payingProductId: "",
          error: error.message || "订单创建失败",
        });
      });
  },

  goCredits: function () {
    wx.navigateTo({
      url: "/pages/credits/index",
    });
  },

  goBilling: function () {
    wx.navigateTo({
      url: "/pages/billing/index",
    });
  },
});
