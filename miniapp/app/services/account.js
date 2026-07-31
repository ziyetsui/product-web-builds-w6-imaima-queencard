var api = require("./api.js");
var session = require("./session.js");

function normalizeUser(payload) {
  var source = payload || {};
  var user = source.user || source.profile || source.account || source;
  return {
    id: user.id || user.userId || user.openid || "",
    nickname: user.nickname || user.nickName || user.name || "",
    avatarUrl: user.avatarUrl || user.avatar_url || user.picture || "",
    email: user.email || "",
    role: user.role || (user.isAdmin ? "admin" : "user"),
    isAdmin: Boolean(user.isAdmin || user.admin || user.role === "admin" || user.role === "superadmin"),
    raw: user,
  };
}

function getMe() {
  return api.getAccountMe().then(function (payload) {
    var user = normalizeUser(payload);
    session.updateUser(user.raw || user);
    return user;
  });
}

function patchAccountMe(input) {
  return api.patchAccountMe(input || {}).then(function (payload) {
    var user = normalizeUser(payload);
    session.updateUser(user.raw || user);
    return user;
  });
}

module.exports = {
  getMe: getMe,
  patchAccountMe: patchAccountMe,
  normalizeUser: normalizeUser,
};
