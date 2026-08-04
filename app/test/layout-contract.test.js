const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");

function readStyle(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), "utf8");
}

function declarationsFor(source, selector) {
  const blocks = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(source))) {
    const selectors = match[1].split(",").map((item) => item.trim());
    if (selectors.includes(selector)) blocks.push(match[2]);
  }

  assert.ok(blocks.length, `missing ${selector} rule`);
  return blocks.join("\n");
}

test("native buttons can shrink inside constrained flex and grid layouts", () => {
  const declarations = declarationsFor(readStyle("app.wxss"), "button");

  assert.match(declarations, /(?:^|;)\s*min-width\s*:\s*0\s*;/);
});

test("generation mode controls keep shrinkable grid tracks and a full-width uploader", () => {
  const source = readStyle("pages/generate/index.wxss");
  const modeRow = declarationsFor(source, ".mode-row");
  const uploadBox = declarationsFor(source, ".upload-box");

  assert.match(modeRow, /grid-template-columns\s*:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(uploadBox, /width\s*:\s*100%\s*!important/);
});

test("page top bars reserve equal side columns for a centered brand", () => {
  const contracts = [
    ["pages/generate/index.wxss", "68rpx"],
    ["pages/history/index.wxss", "68rpx"],
    ["pages/credits/index.wxss", "68rpx"],
    ["pages/account/index.wxss", "68rpx"],
    ["pages/result/index.wxss", "112rpx"],
    ["pages/pricing/index.wxss", "112rpx"],
    ["pages/billing/index.wxss", "112rpx"],
    ["pages/admin/index.wxss", "112rpx"],
  ];

  for (const [relativePath, sideColumn] of contracts) {
    const topbar = declarationsFor(readStyle(relativePath), ".topbar");
    assert.match(topbar, /display\s*:\s*grid\s*;/, relativePath);
    assert.match(
      topbar,
      new RegExp(`grid-template-columns\\s*:\\s*${sideColumn}\\s+minmax\\(0,\\s*1fr\\)\\s+${sideColumn}`),
      relativePath,
    );
  }
});

test("button grids explicitly override the native button width", () => {
  const contracts = [
    ["pages/credits/index.wxss", ".small-button", /width\s*:\s*104rpx\s*!important/],
    ["pages/account/index.wxss", ".small-button", /width\s*:\s*100%\s*!important/],
    ["pages/account/index.wxss", ".nav-button", /width\s*:\s*100%\s*!important/],
    ["pages/pricing/index.wxss", ".pay-button", /width\s*:\s*100%\s*!important/],
    ["pages/admin/index.wxss", ".submit-button", /width\s*:\s*100%\s*!important/],
  ];

  for (const [relativePath, selector, pattern] of contracts) {
    assert.match(declarationsFor(readStyle(relativePath), selector), pattern, `${relativePath} ${selector}`);
  }
});
