#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const defaultAncherDir = "/Users/a2/Desktop/ancherexplainfrontend";
const ancherDir = process.env.ANCHER_FRONTEND_DIR || defaultAncherDir;
const gitRef = process.env.ANCHER_GIT_REF || "origin/master";
const outputFile = path.join(repoRoot, "ima ima queencard/frontend/src/data/boLandingPromptCases.ts");

function requireTypeScript() {
  const candidates = [
    path.join(repoRoot, "ima ima queencard/frontend/node_modules/typescript"),
    path.join(ancherDir, "node_modules/typescript"),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error("typescript dependency not found; run pnpm install in frontend first");
}

const ts = requireTypeScript();

function git(args) {
  return childProcess.execFileSync("git", args, {
    cwd: ancherDir,
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
  });
}

function listGitFiles(dir, pattern) {
  return git(["ls-tree", "-r", "--name-only", gitRef, dir])
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((file) => pattern.test(file))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

function readGitFile(file) {
  return git(["show", `${gitRef}:${file}`]);
}

function evaluateTsModule(file) {
  const source = readGitFile(file);
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  const module = { exports: {} };
  const sandbox = {
    exports: module.exports,
    module,
    require,
    console,
  };
  vm.runInNewContext(js, sandbox, { filename: file, timeout: 3000 });
  return module.exports;
}

function exportedArrays(file) {
  const exports = evaluateTsModule(file);
  return Object.values(exports).filter(Array.isArray);
}

function loadCases(files) {
  const result = [];
  for (const file of files) {
    for (const value of exportedArrays(file)) result.push(...value);
  }
  return result;
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asNumber(value) {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next : 0;
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = compactText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function normalizeCase(record, group) {
  const originalCategory = compactText(record.category);
  const contentType = compactText(record.contentType);
  const subtitle = compactText(record.subtitle) || compactText([group, contentType || originalCategory].filter(Boolean).join(" / "));
  const images = Array.isArray(record.images) ? record.images.filter(Boolean) : [];
  const image = compactText(record.image) || compactText(images[0]);

  return {
    id: compactText(record.id),
    title: compactText(record.title) || compactText(record.sourceTitle) || "未命名模板",
    subtitle,
    category: group,
    author: compactText(record.author),
    date: compactText(record.date),
    image,
    images: images.length ? images : image ? [image] : [],
    noteUrl: compactText(record.noteUrl),
    authorUrl: compactText(record.authorUrl),
    topics: unique([group, originalCategory, contentType, record.subjectDomain, ...(record.topics || [])]),
    likes: asNumber(record.likes),
    saves: asNumber(record.saves),
    shares: asNumber(record.shares),
    likesText: compactText(record.likesText),
    savesText: compactText(record.savesText),
    sharesText: compactText(record.sharesText),
    prompt: compactText(record.prompt),
    sourceTitle: compactText(record.sourceTitle) || compactText(record.title),
  };
}

function main() {
  const viralFiles = listGitFiles("src/app/landing/_data/social-prompt-cases", /\/part\d+\.ts$/);
  const wechatFiles = listGitFiles("src/app/landing/_data/wechat-cover-cases", /\/part\d+\.ts$/);
  const memeFiles = ["src/app/landing/_data/social-prompt-cases/meme.ts"];

  const groups = [
    ["爆款图文", viralFiles],
    ["梗图", memeFiles],
    ["公众号配图", wechatFiles],
  ];
  const records = groups.flatMap(([group, files]) => loadCases(files).map((record) => normalizeCase(record, group)));
  const seen = new Set();
  const deduped = records.filter((record) => {
    if (!record.id || seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });

  const output = `import type { XhsPromptCase } from "./xhsPromptCases";

// Generated from ${gitRef} in ${ancherDir}.
// Source groups: 爆款图文, 梗图, 公众号配图.
export const boLandingPromptCases: XhsPromptCase[] = ${JSON.stringify(deduped, null, 2)};
`;

  fs.writeFileSync(outputFile, output, "utf8");
  const counts = deduped.reduce((map, record) => {
    map[record.category] = (map[record.category] || 0) + 1;
    return map;
  }, {});
  console.log(JSON.stringify({ total: deduped.length, counts }, null, 2));
}

main();
