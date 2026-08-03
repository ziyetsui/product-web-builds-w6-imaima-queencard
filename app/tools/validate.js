const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "app.json",
  "app.js",
  "app.wxss",
  "project.config.json",
  "sitemap.json",
  "pages/index/index.json",
  "pages/index/index.js",
  "pages/index/index.wxml",
  "pages/index/index.wxss",
  "pages/generate/index.json",
  "pages/generate/index.js",
  "pages/generate/index.wxml",
  "pages/generate/index.wxss",
  "pages/result/index.json",
  "pages/result/index.js",
  "pages/result/index.wxml",
  "pages/result/index.wxss",
  "pages/history/index.json",
  "pages/history/index.js",
  "pages/history/index.wxml",
  "pages/history/index.wxss",
  "pages/credits/index.json",
  "pages/credits/index.js",
  "pages/credits/index.wxml",
  "pages/credits/index.wxss",
  "pages/pricing/index.json",
  "pages/pricing/index.js",
  "pages/pricing/index.wxml",
  "pages/pricing/index.wxss",
  "pages/account/index.json",
  "pages/account/index.js",
  "pages/account/index.wxml",
  "pages/account/index.wxss",
  "pages/billing/index.json",
  "pages/billing/index.js",
  "pages/billing/index.wxml",
  "pages/billing/index.wxss",
  "pages/admin/index.json",
  "pages/admin/index.js",
  "pages/admin/index.wxml",
  "pages/admin/index.wxss",
  "config/env.js",
  "services/api.js",
  "services/auth.js",
  "services/account.js",
  "services/admin.js",
  "services/billing.js",
  "services/credits.js",
  "services/generation.js",
  "services/session.js",
  "services/templates.js",
  "test/api-auth.test.js",
  "test/catalog-client.test.js",
  "docs/miniapp-backend-contract.md",
  "data/landing.js",
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`);
    return {};
  }
}

function walk(value, visit) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => walk(item, visit));
    return;
  }
  visit(value);
}

requiredFiles.forEach((file) => {
  if (!fs.existsSync(path.join(root, file))) {
    fail(`missing required file ${file}`);
  }
});

const appJson = readJson("app.json");
const projectJson = readJson("project.config.json");

if (!Array.isArray(appJson.pages) || !appJson.pages.includes("pages/index/index")) {
  fail("app.json must include pages/index/index");
}

["pages/generate/index", "pages/result/index", "pages/history/index", "pages/credits/index", "pages/pricing/index", "pages/account/index", "pages/billing/index", "pages/admin/index"].forEach((page) => {
  if (!Array.isArray(appJson.pages) || !appJson.pages.includes(page)) {
    fail(`app.json must include ${page}`);
  }
});

if (projectJson.compileType !== "miniprogram") {
  fail("project.config.json compileType must be miniprogram");
}

const landing = require(path.join(root, "data/landing.js"));
const env = require(path.join(root, "config/env.js"));
const assetPaths = new Set();
const remoteUrls = [];
const apiBaseUrl = (env.API_BASE_URL || "").replace(/\/$/, "");

walk(landing, (value) => {
  if (typeof value !== "string") return;
  if (/^https?:\/\//.test(value)) remoteUrls.push(value);
  if (value.startsWith("/assets/")) assetPaths.add(value);
});

const invalidRemoteUrls = remoteUrls.filter((url) => !apiBaseUrl || !url.startsWith(`${apiBaseUrl}/`));
if (invalidRemoteUrls.length > 0) {
  fail(`landing data contains unsupported remote URLs: ${invalidRemoteUrls.join(", ")}`);
}

assetPaths.forEach((assetPath) => {
  const fullPath = path.join(root, assetPath.slice(1));
  if (!fs.existsSync(fullPath)) {
    fail(`missing asset ${assetPath}`);
  }
});

let assetBytes = 0;
for (const assetPath of assetPaths) {
  assetBytes += fs.statSync(path.join(root, assetPath.slice(1))).size;
}

const assetMb = assetBytes / 1024 / 1024;
if (assetMb > 8) {
  fail(`asset bundle is ${assetMb.toFixed(1)}MB; keep first version below 8MB`);
}

const wxml = fs.readFileSync(path.join(root, "pages/index/index.wxml"), "utf8");
if (wxml.includes("href=") || wxml.includes("<a ")) {
  fail("WXML should not contain web anchor tags");
}

const resultPageSource = fs.readFileSync(path.join(root, "pages/result/index.js"), "utf8");
const apiSource = fs.readFileSync(path.join(root, "services/api.js"), "utf8");
const templateServiceSource = fs.readFileSync(path.join(root, "services/templates.js"), "utf8");
const pricingPageSource = fs.readFileSync(path.join(root, "pages/pricing/index.js"), "utf8");
const accountPageSource = fs.readFileSync(path.join(root, "pages/account/index.js"), "utf8");
const billingPageSource = fs.readFileSync(path.join(root, "pages/billing/index.js"), "utf8");
const adminPageSource = fs.readFileSync(path.join(root, "pages/admin/index.js"), "utf8");
if (/wx\.redirectTo\(\s*{\s*url:\s*["']\/pages\/generate\/index["']/.test(resultPageSource)) {
  fail("result page must navigateBack to the previous generate page instead of redirecting to a blank generate page");
}

[
  "listPricingProducts",
  "createOrder",
  "listOrders",
  "getBilling",
  "mockPayOrder",
  "getAccountMe",
  "patchAccountMe",
  "listAdminUsers",
  "listAdminOrders",
  "listAdminPaymentAudit",
  "adminAddCredits",
  "getImageAssetDownloadUrl",
].forEach((pattern) => {
  if (!apiSource.includes(pattern)) {
    fail(`services/api.js must expose ${pattern}`);
  }
});

if (!/wx\.requestPayment/.test(pricingPageSource) || !/mockPayOrder/.test(pricingPageSource)) {
  fail("pricing page must create orders, use wx.requestPayment when available, and support mock payment fallback");
}

["catalogVersion", "cancelPending", "stale"].forEach((pattern) => {
  if (!templateServiceSource.includes(pattern)) {
    fail(`services/templates.js must support version-aware cache and stale request handling: missing ${pattern}`);
  }
});

["patchAccountMe", "logout", "goBilling", "goAdmin"].forEach((pattern) => {
  if (!accountPageSource.includes(pattern)) {
    fail(`account page must support ${pattern}`);
  }
});

["listOrders", "getBilling"].forEach((pattern) => {
  if (!billingPageSource.includes(pattern)) {
    fail(`billing page must support ${pattern}`);
  }
});

["listAdminUsers", "listAdminOrders", "listAdminPaymentAudit", "adminAddCredits"].forEach((pattern) => {
  if (!adminPageSource.includes(pattern)) {
    fail(`admin page must support ${pattern}`);
  }
});

if (!/getImageAssetDownloadUrl/.test(resultPageSource) || !/assetId/.test(resultPageSource)) {
  fail("result page must prefer safe asset download endpoint before direct image URL fallback");
}

const generatePageSource = fs.readFileSync(path.join(root, "pages/generate/index.js"), "utf8");
if (!/DEFAULT_MODEL_LABEL\s*=\s*"GPT Image 2"/.test(generatePageSource)) {
  fail("generate page default model label constant must be GPT Image 2");
}

if (!/label:\s*DEFAULT_MODEL_LABEL\s*,\s*value:\s*DEFAULT_MODEL_VALUE/.test(generatePageSource)) {
  fail("generate page must expose GPT Image 2 as the miniapp default model option");
}

if (!/modelLabel:\s*DEFAULT_MODEL_LABEL/.test(generatePageSource)) {
  fail("generate page default model label must be GPT Image 2");
}

if (!/DEFAULT_MODEL_VALUE\s*=\s*"gpt-image-2-edit"/.test(generatePageSource)) {
  fail("generate page must centralize the default model as gpt-image-2-edit");
}

if (/modelIndexFor\(page\.data\.models,\s*seed\.model\)/.test(generatePageSource)) {
  fail("template seed model must not override the miniapp GPT Image 2 default");
}

["prefillFromOptions", "referenceImage", "sourceTaskId", "estimatePayload", "refreshEstimate"].forEach((pattern) => {
  if (!generatePageSource.includes(pattern)) {
    fail(`generate page must support history reuse and credit estimate: missing ${pattern}`);
  }
});

["MODE_TEXT_TO_IMAGE", "MODE_IMAGE_EDIT", "MAX_REFERENCE_IMAGES", "referenceImagePaths", "availableModels"].forEach((pattern) => {
  if (!generatePageSource.includes(pattern)) {
    fail(`generate page must support dual-mode generation and up to three references: missing ${pattern}`);
  }
});

const indexPageSource = fs.readFileSync(path.join(root, "pages/index/index.js"), "utf8");
["templateCursor", "templateLoading", "templateError", "markServerCategoryOptions", "templateHasMore", "热门高赞", "hotOnly"].forEach((pattern) => {
  if (!indexPageSource.includes(pattern)) {
    fail(`index page must support catalog discovery state: missing ${pattern}`);
  }
});
["openHistory", "openCredits"].forEach((pattern) => {
  if (!indexPageSource.includes(pattern)) {
    fail(`index page must expose ${pattern}`);
  }
});

["openHistory", "reuseImage", "regenerateTask"].forEach((pattern) => {
  if (!resultPageSource.includes(pattern)) {
    fail(`result page must expose ${pattern}`);
  }
});

const envSource = fs.readFileSync(path.join(root, "config/env.js"), "utf8");
if (/APP_SECRET|OPENAI_API_KEY|GPTPROTO_API_KEY|FIREBASE_PRIVATE_KEY/.test(envSource)) {
  fail("config/env.js must not contain server-side secrets");
}

const authApiSource = fs.readFileSync(path.join(root, "services/auth.js"), "utf8");
if (!/loginWithWechatProfile/.test(authApiSource) || !/logout/.test(authApiSource)) {
  fail("services/auth.js must expose login and logout lifecycle methods");
}

const apiRequestSource = fs.readFileSync(path.join(root, "services/api.js"), "utf8");
if (!/SESSION_EXPIRED|AUTH_REQUIRED|ACCOUNT_DISABLED/.test(apiRequestSource)
  || !/authRetry/.test(apiRequestSource)
  || !/clearSession/.test(apiRequestSource)
  || !/pages\/account\/index\?auth=required/.test(apiRequestSource)) {
  fail("services/api.js must handle terminal auth responses without rendering raw 401 text");
}

if (process.exitCode) {
  process.exit();
}

console.log(`OK: ${requiredFiles.length} files, ${assetPaths.size} local assets, ${assetMb.toFixed(1)}MB assets, ${remoteUrls.length} backend assets`);
