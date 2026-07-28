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
  "config/env.js",
  "services/api.js",
  "services/auth.js",
  "services/session.js",
  "services/templates.js",
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

["pages/generate/index", "pages/result/index"].forEach((page) => {
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

const envSource = fs.readFileSync(path.join(root, "config/env.js"), "utf8");
if (/APP_SECRET|OPENAI_API_KEY|GPTPROTO_API_KEY|FIREBASE_PRIVATE_KEY/.test(envSource)) {
  fail("config/env.js must not contain server-side secrets");
}

if (process.exitCode) {
  process.exit();
}

console.log(`OK: ${requiredFiles.length} files, ${assetPaths.size} local assets, ${assetMb.toFixed(1)}MB assets, ${remoteUrls.length} backend assets`);
