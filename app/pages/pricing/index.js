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
    paymentState: "",
    paymentStateLabel: "",
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
      paymentState: "",
      paymentStateLabel: "",
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
    var status = billing.describeOrderStatus(order, "fulfilled");
    this.refreshCredits();
    this.setData({
      payingProductId: "",
      notice: message || status.message,
      paymentState: status.state,
      paymentStateLabel: status.label,
      error: "",
    });
    wx.showModal({
      title: status.label,
      content: message || status.message,
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

  setPaymentState: function (state, message) {
    var status = billing.describeOrderStatus({}, state);
    this.setData({
      payingProductId: "",
      paymentState: status.state,
      paymentStateLabel: status.label,
      notice: message || status.message,
      error: "",
    });
  },

  waitForOrder: function (orderId, attempt, previousOrder) {
    var page = this;
    var currentAttempt = attempt || 0;
    return billing.reconcileOrder(orderId).then(function (result) {
      var latest = result.order || previousOrder || {};
      var payment = billing.describeOrderStatus(latest, "paid_syncing");
      if (payment.state === "fulfilled") return latest;
      if (["failed", "canceled", "refunded"].indexOf(payment.state) >= 0) {
        var terminalError = new Error(payment.message);
        terminalError.paymentState = payment.state;
        throw terminalError;
      }
      if (currentAttempt >= 10) {
        var syncError = new Error(payment.message);
        syncError.paymentState = "paid_syncing";
        throw syncError;
      }
      page.setPaymentState("paid_syncing", payment.message);
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve(page.waitForOrder(orderId, currentAttempt + 1, latest));
        }, 1500);
      });
    });
  },

  offerMockPay: function (order) {
    var page = this;
    if (!billing.isMockPaymentAvailable(order)) {
      this.setPaymentState("failed", "当前订单缺少可用支付参数，支付通道暂不可用，请稍后重试。");
      return;
    }
    wx.showModal({
      title: "开发支付完成",
      content: "后端没有返回 paymentParams。可调用 mock-pay 接口把这笔订单标记为已支付。",
      confirmText: "mock 完成",
      cancelText: "稍后处理",
      success: function (res) {
        if (!res.confirm) {
          page.setPaymentState("pending", "订单已创建，可稍后在订单页继续处理。");
          return;
        }
        billing.mockPayOrder(order.id)
          .then(function (result) {
            page.completeOrder(result.order || order, "mock-pay 已完成，积分已刷新。");
          })
          .catch(function (error) {
            page.setPaymentState("failed", "开发支付未完成，请稍后重试。");
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
          if (!billing.isMockPaymentAvailable(order)) {
            page.setPaymentState("failed", "当前订单缺少可用支付参数，支付通道暂不可用，请稍后重试。");
            return;
          }
          page.offerMockPay(order);
          return;
        }
        requestPayment(result.paymentParams)
          .then(function () {
            page.setPaymentState("paid_syncing");
            page.waitForOrder(order.id)
              .then(function (latest) {
                page.completeOrder(latest || order, "微信支付已完成，积分已刷新。");
              })
              .catch(function (error) {
                var paymentState = error && error.paymentState || "paid_syncing";
                var paymentMessage = error && error.paymentState
                  ? error.message
                  : billing.describeOrderStatus({}, "paid_syncing").message;
                page.setPaymentState(paymentState, paymentMessage);
                page.refreshCredits();
              });
          })
          .catch(function (error) {
            var paymentError = billing.describePaymentError(error);
            page.setPaymentState(paymentError.state, paymentError.message);
          });
      })
      .catch(function (error) {
        page.setData({
          payingProductId: "",
          error: error.message || "订单创建失败",
          paymentState: "",
          paymentStateLabel: "",
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
