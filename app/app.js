App({
  globalData: {
    productName: "ima ima queencard",
  },

  handleAuthRequired: function () {
    if (this.authRedirecting) return;
    this.authRedirecting = true;
    var app = this;
    wx.navigateTo({
      url: "/pages/account/index?auth=required",
      complete: function () {
        app.authRedirecting = false;
      },
    });
  },
});
