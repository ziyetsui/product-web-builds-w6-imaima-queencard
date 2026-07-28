var env = require("../config/env.js");
var session = require("./session.js");

function isConfigured() {
  return Boolean(env.API_BASE_URL && env.API_BASE_URL.indexOf("http") === 0);
}

function buildQuery(query) {
  var parts = [];
  var key = "";
  if (!query) return "";
  for (key in query) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) continue;
    if (query[key] === undefined || query[key] === null || query[key] === "") continue;
    parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(query[key])));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

function endpoint(path, query) {
  return env.API_BASE_URL.replace(/\/$/, "") + env.MINIAPP_API_PREFIX + path + buildQuery(query);
}

function request(options) {
  if (!isConfigured()) {
    return Promise.reject(new Error("后端 API 未配置，请先设置 config/env.js 里的 API_BASE_URL"));
  }

  return new Promise(function (resolve, reject) {
    var token = session.getToken();
    wx.request({
      url: endpoint(options.path, options.query),
      method: options.method || "GET",
      data: options.data || {},
      timeout: env.REQUEST_TIMEOUT,
      header: {
        "content-type": "application/json",
        authorization: token ? "Bearer " + token : "",
      },
      success: function (res) {
        var payload = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && payload.success !== false) {
          resolve(payload.data !== undefined ? payload.data : payload);
          return;
        }
        reject(new Error(payload.error || payload.message || "请求失败：" + res.statusCode));
      },
      fail: function (error) {
        reject(new Error(error.errMsg || "网络请求失败"));
      },
    });
  });
}

function uploadReferenceImage(filePath) {
  if (!isConfigured()) {
    return Promise.reject(new Error("后端 API 未配置，请先设置 config/env.js 里的 API_BASE_URL"));
  }

  return new Promise(function (resolve, reject) {
    var token = session.getToken();
    wx.uploadFile({
      url: endpoint("/uploads/reference-image"),
      filePath: filePath,
      name: "file",
      timeout: env.REQUEST_TIMEOUT,
      header: {
        authorization: token ? "Bearer " + token : "",
      },
      success: function (res) {
        var payload = {};
        try {
          payload = JSON.parse(res.data || "{}");
        } catch (error) {
          reject(new Error("上传响应不是合法 JSON"));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && payload.success !== false) {
          resolve(payload.data || payload);
          return;
        }
        reject(new Error(payload.error || payload.message || "上传失败：" + res.statusCode));
      },
      fail: function (error) {
        reject(new Error(error.errMsg || "图片上传失败"));
      },
    });
  });
}

function loginWithWechat(code, profile) {
  return request({
    path: "/auth/wechat-login",
    method: "POST",
    data: {
      code: code,
      profile: profile || {},
    },
  });
}

function getMe() {
  return request({
    path: "/auth/me",
  });
}

function createGenerationTask(input) {
  return request({
    path: "/image-generations",
    method: "POST",
    data: input,
  });
}

function getGenerationTask(taskId) {
  return request({
    path: "/image-generations/" + encodeURIComponent(taskId),
  });
}

module.exports = {
  isConfigured: isConfigured,
  request: request,
  loginWithWechat: loginWithWechat,
  getMe: getMe,
  uploadReferenceImage: uploadReferenceImage,
  createGenerationTask: createGenerationTask,
  getGenerationTask: getGenerationTask,
};
