var api = require("../../services/api.js");
var billing = require("../../services/billing.js");

function formatTime(value) {
  var date = new Date(value);
  if (!value || isNaN(date.getTime())) return value || "刚刚";
  return (date.getMonth() + 1) + "/" + date.getDate() + " " + (date.getHours() < 10 ? "0" + date.getHours() : date.getHours()) + ":" + (date.getMinutes() < 10 ? "0" + date.getMinutes() : date.getMinutes());
}

function decorateOrder(order) {
  var payment = billing.describeOrderStatus(order);
  return {
    id: order.id,
    title: order.productName,
    desc: order.credits ? order.credits + " 积分 · " + order.channel : order.channel,
    amount: order.amountLabel,
    status: payment.label,
    statusKey: payment.state,
    statusMessage: payment.message,
    createdAtLabel: formatTime(order.createdAt),
  };
}

function decorateBilling(row) {
  return {
    id: row.id,
    title: row.title,
    desc: row.status,
    amount: row.amountLabel,
    status: row.status,
    createdAtLabel: formatTime(row.createdAt),
  };
}

Page({
  data: {
    apiReady: api.isConfigured(),
    activeTab: "orders",
    orders: [],
    billingRows: [],
    loading: false,
    error: "",
    highlightedOrderId: "",
  },

  onLoad: function (options) {
    this.setData({
      highlightedOrderId: options && options.orderId ? decodeURIComponent(options.orderId) : "",
    });
    this.loadPage();
  },

  onPullDownRefresh: function () {
    this.loadPage().finally(function () {
      wx.stopPullDownRefresh();
    });
  },

  loadPage: function () {
    var page = this;
    this.setData({
      apiReady: api.isConfigured(),
      loading: true,
      error: "",
    });

    if (!api.isConfigured()) {
      this.setData({
        loading: false,
        error: "后端 API 未配置，无法读取订单账单。",
      });
      return Promise.resolve();
    }

    return Promise.all([
      billing.listOrders({ limit: 30 }),
      billing.getBilling({ limit: 30 }),
    ])
      .then(function (results) {
        page.setData({
          orders: results[0].map(decorateOrder),
          billingRows: results[1].map(decorateBilling),
          loading: false,
          error: "",
        });
      })
      .catch(function (error) {
        page.setData({
          loading: false,
          error: error.message || "账单读取失败",
        });
      });
  },

  selectTab: function (event) {
    this.setData({
      activeTab: event.currentTarget.dataset.tab || "orders",
    });
  },

  goPricing: function () {
    wx.navigateTo({ url: "/pages/pricing/index" });
  },

  goAccount: function () {
    wx.navigateTo({ url: "/pages/account/index" });
  },
});
