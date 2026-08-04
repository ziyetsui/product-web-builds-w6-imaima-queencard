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

function isPublicRequest(options) {
  if (options && options.protected === true) return false;
  if (options && options.protected === false) return true;
  var path = String(options && options.path || "");
  return path === "/auth/wechat-login"
    || path === "/pricing"
    || path === "/models"
    || path === "/templates"
    || /^\/templates\/[^/]+$/.test(path);
}

function authRequiredError(code) {
  var error = new Error("登录状态已失效，请重新登录");
  error.code = code || "AUTH_REQUIRED";
  error.statusCode = 401;
  error.authRequired = true;
  return error;
}

function redirectToAccount() {
  var app = typeof getApp === "function" ? getApp() : null;
  if (app && typeof app.handleAuthRequired === "function") {
    app.handleAuthRequired();
    return;
  }
  if (typeof wx !== "undefined" && wx.navigateTo) {
    wx.navigateTo({ url: "/pages/account/index?auth=required" });
  }
}

function terminalAuthFailure(payload) {
  session.clearSession();
  redirectToAccount();
  return authRequiredError(payload && payload.code);
}

function loginForRetry() {
  var auth = require("./auth.js");
  return auth.loginWithWechatProfile({ source: "session-retry" }, { silent: true });
}

function loginThenRetry(retry) {
  return loginForRetry().then(retry, function (error) {
    return Promise.reject(error && error.authRequired ? error : terminalAuthFailure());
  });
}

function request(options, authRetry) {
  if (!isConfigured()) {
    return Promise.reject(new Error("后端 API 未配置，请先设置 config/env.js 里的 API_BASE_URL"));
  }

  var requestOptions = options || {};
  return new Promise(function (resolve, reject) {
    var token = session.getToken();
    var requestTask = wx.request({
      url: endpoint(requestOptions.path, requestOptions.query),
      method: requestOptions.method || "GET",
      data: requestOptions.data || {},
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
        if (res.statusCode === 401) {
          if (!isPublicRequest(requestOptions) && !authRetry) {
            loginThenRetry(function () {
              return request(requestOptions, true);
            })
              .then(resolve)
              .catch(function (error) {
                reject(error && error.authRequired ? error : error || new Error("请求失败"));
              });
            return;
          }
          reject(terminalAuthFailure(payload));
          return;
        }
        reject(new Error(payload.error || payload.message || "请求失败"));
      },
      fail: function (error) {
        reject(new Error(error.errMsg || "网络请求失败"));
      },
    });
    if (typeof requestOptions.onRequest === "function") requestOptions.onRequest(requestTask);
  });
}

function authHeader() {
  var token = session.getToken();
  return {
    authorization: token ? "Bearer " + token : "",
  };
}

function uploadReferenceImage(filePath, authRetry) {
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
        if (res.statusCode === 401 && !authRetry) {
          loginThenRetry(function () {
            return uploadReferenceImage(filePath, true);
          })
            .then(resolve)
            .catch(function (error) {
              reject(error && error.authRequired ? error : error || new Error("上传失败"));
            });
          return;
        }
        if (res.statusCode === 401) {
          reject(terminalAuthFailure(payload));
          return;
        }
        reject(new Error(payload.error || payload.message || "上传失败"));
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
    protected: false,
  });
}

function logout() {
  if (!session.getToken()) return Promise.resolve(null);
  return request({
    path: "/auth/logout",
    method: "POST",
    protected: false,
  });
}

function getMe() {
  return request({
    path: "/auth/me",
  });
}

function listPricingProducts() {
  return request({
    path: "/pricing",
  });
}

function listImageModels() {
  return request({
    path: "/models",
    protected: false,
  });
}

function createOrder(productId, channel) {
  return request({
    path: "/orders",
    method: "POST",
    data: {
      productId: productId,
      channel: channel || "wechat",
    },
  });
}

function listOrders(query) {
  return request({
    path: "/orders",
    query: query || {},
  });
}

function getOrder(orderId) {
  return request({
    path: "/orders/" + encodeURIComponent(orderId || ""),
  });
}

function getBilling(query) {
  return request({
    path: "/billing",
    query: query || {},
  });
}

function mockPayOrder(orderId) {
  return request({
    path: "/orders/" + encodeURIComponent(orderId) + "/mock-pay",
    method: "POST",
  });
}

function getAccountMe() {
  return request({
    path: "/account/me",
  });
}

function patchAccountMe(input) {
  return request({
    path: "/account/me",
    method: "PATCH",
    data: input || {},
  });
}

function listAdminUsers(query) {
  return request({
    path: "/admin/users",
    query: query || {},
  });
}

function listAdminOrders(query) {
  return request({
    path: "/admin/orders",
    query: query || {},
  });
}

function listAdminPaymentAudit(query) {
  return request({
    path: "/admin/payment-audit",
    query: query || {},
  });
}

function adminAddCredits(input) {
  var userId = input && (input.userId || input.targetUserId || input.id);
  return request({
    path: "/admin/users/" + encodeURIComponent(userId || "") + "/credits",
    method: "POST",
    data: input || {},
  });
}

function imageAssetDownloadPath(assetId, options) {
  var value = String(assetId || "");
  var encoded = options && options.encoded ? value : encodeURIComponent(value);
  return "/image-assets/" + encoded + "/download";
}

function buildImageAssetDownloadEndpoint(assetId, options) {
  return endpoint(imageAssetDownloadPath(assetId, options));
}

function getImageAssetDownloadUrl(assetId, options) {
  // wx.request does not expose a 302 Location reliably. Let wx.downloadFile
  // follow the owner-scoped redirect with the Authorization header instead.
  return Promise.resolve(buildImageAssetDownloadEndpoint(assetId, options));
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

function listGenerationTasks(query) {
  return request({
    path: "/image-generations",
    query: query || {},
  });
}

function estimateGeneration(input) {
  return request({
    path: "/image-generations/estimate",
    method: "POST",
    data: input || {},
  });
}

function regenerateGenerationTask(taskId, input) {
  return request({
    path: "/image-generations/" + encodeURIComponent(taskId) + "/regenerate",
    method: "POST",
    data: input || {},
  });
}

function getCreditBalance() {
  return request({
    path: "/credit/balance",
  });
}

function getCreditHistory(query) {
  return request({
    path: "/credit/history",
    query: query || {},
  });
}

module.exports = {
  isConfigured: isConfigured,
  request: request,
  authHeader: authHeader,
  loginWithWechat: loginWithWechat,
  logout: logout,
  getMe: getMe,
  listPricingProducts: listPricingProducts,
  listImageModels: listImageModels,
  createOrder: createOrder,
  listOrders: listOrders,
  getOrder: getOrder,
  getBilling: getBilling,
  mockPayOrder: mockPayOrder,
  getAccountMe: getAccountMe,
  patchAccountMe: patchAccountMe,
  listAdminUsers: listAdminUsers,
  listAdminOrders: listAdminOrders,
  listAdminPaymentAudit: listAdminPaymentAudit,
  adminAddCredits: adminAddCredits,
  getImageAssetDownloadUrl: getImageAssetDownloadUrl,
  buildImageAssetDownloadEndpoint: buildImageAssetDownloadEndpoint,
  uploadReferenceImage: uploadReferenceImage,
  createGenerationTask: createGenerationTask,
  getGenerationTask: getGenerationTask,
  listGenerationTasks: listGenerationTasks,
  estimateGeneration: estimateGeneration,
  regenerateGenerationTask: regenerateGenerationTask,
  getCreditBalance: getCreditBalance,
  getCreditHistory: getCreditHistory,
};
