var TOKEN_KEY = "ima_queencard_mini_token";
var USER_KEY = "ima_queencard_mini_user";

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || "";
}

function setSession(session) {
  wx.setStorageSync(TOKEN_KEY, session.token || "");
  wx.setStorageSync(USER_KEY, session.user || null);
}

function clearSession() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
}

function getUser() {
  return wx.getStorageSync(USER_KEY) || null;
}

module.exports = {
  getToken: getToken,
  setSession: setSession,
  clearSession: clearSession,
  getUser: getUser,
};
