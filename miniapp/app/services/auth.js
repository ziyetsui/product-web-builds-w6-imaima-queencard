var api = require("./api.js");
var session = require("./session.js");

function wxLoginCode() {
  return new Promise(function (resolve, reject) {
    wx.login({
      success: function (res) {
        if (res.code) {
          resolve(res.code);
          return;
        }
        reject(new Error("wx.login 没有返回 code"));
      },
      fail: function (error) {
        reject(new Error(error.errMsg || "微信登录失败"));
      },
    });
  });
}

function loginWithWechatProfile(profile) {
  return wxLoginCode().then(function (code) {
    return api.loginWithWechat(code, profile || {}).then(function (result) {
      session.setSession(result);
      return result;
    });
  });
}

function getCurrentUser() {
  return session.getUser();
}

function logout() {
  session.clearSession();
}

module.exports = {
  loginWithWechatProfile: loginWithWechatProfile,
  getCurrentUser: getCurrentUser,
  logout: logout,
};
