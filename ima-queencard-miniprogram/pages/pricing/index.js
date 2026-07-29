var PACKS = [
  {
    id: "starter",
    name: "灵感包",
    credits: 30,
    price: "¥19",
    accent: "lemon",
    desc: "适合试做爆款封面、单图改写和少量组图探索。",
  },
  {
    id: "creator",
    name: "创作者包",
    credits: 120,
    price: "¥59",
    accent: "seafoam",
    desc: "适合持续产出小红书图文，覆盖多轮生成和筛选。",
  },
  {
    id: "team",
    name: "团队包",
    credits: 360,
    price: "¥159",
    accent: "pumpkin",
    desc: "适合矩阵账号、门店活动和批量素材测试。",
  },
];

Page({
  data: {
    packs: PACKS,
  },

  choosePack: function () {
    wx.showModal({
      title: "微信支付接入中",
      content: "当前页面先展示小程序内购结构，正式支付会通过 wx.requestPayment 接入。",
      confirmText: "知道了",
      showCancel: false,
    });
  },

  goCredits: function () {
    wx.navigateTo({
      url: "/pages/credits/index",
    });
  },
});
