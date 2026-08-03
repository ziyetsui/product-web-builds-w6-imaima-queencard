#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { buildCatalogSnapshot } = require("../src/services/catalog-service");

function usage() {
  return [
    "Usage: node scripts/build-template-catalog.js --source-ref <git-ref> --bo-source <path|git-ref:path> --xhs-source <path|git-ref:path>",
    "       [--xhs-metrics-source <path|git-ref:path>]",
    "       [--asset-root <backend/public>] [--output <backend/catalog/catalog.snapshot.json>]",
  ].join("\n");
}

function argument(name, args, required = true) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : "";
  if (required && (!value || value.startsWith("--"))) throw new Error(`Missing ${name}\n${usage()}`);
  return value || "";
}

function extractArray(sourceText, exportName) {
  const marker = `export const ${exportName}`;
  const markerIndex = sourceText.indexOf(marker);
  if (markerIndex < 0) throw new Error(`${exportName} export not found`);
  const start = sourceText.indexOf("[", sourceText.indexOf("=", markerIndex));
  if (start < 0) throw new Error(`${exportName} array not found`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return sourceText.slice(start, index + 1);
    }
  }
  throw new Error(`${exportName} array did not terminate`);
}

function readSource(value) {
  const separator = value.indexOf(":");
  if (separator > 0 && !path.isAbsolute(value.slice(0, separator)) && !fs.existsSync(value)) {
    const ref = value.slice(0, separator);
    const file = value.slice(separator + 1);
    return childProcess.execFileSync("git", ["show", `${ref}:${file}`], {
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
    });
  }
  return fs.readFileSync(path.resolve(value), "utf8");
}

function parseSource(value, exportName) {
  const literal = extractArray(readSource(value), exportName);
  return vm.runInNewContext(`(${literal})`, {}, { timeout: 10000 });
}

function parseObjectSource(value, exportName) {
  const source = readSource(value);
  const marker = `export const ${exportName}`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`${exportName} export not found`);
  const start = source.indexOf("{", source.indexOf("=", markerIndex));
  if (start < 0) throw new Error(`${exportName} object not found`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return vm.runInNewContext(`(${source.slice(start, index + 1)})`, {}, { timeout: 10000 });
    }
  }
  throw new Error(`${exportName} object did not terminate`);
}

function main() {
  const args = process.argv.slice(2);
  const sourceRef = argument("--source-ref", args);
  const boSource = argument("--bo-source", args);
  const xhsSource = argument("--xhs-source", args);
  const xhsMetricsSource = argument("--xhs-metrics-source", args, false);
  const assetRoot = path.resolve(argument("--asset-root", args, false) || path.resolve(__dirname, "../public"));
  const output = path.resolve(argument("--output", args, false) || path.resolve(__dirname, "../catalog/catalog.snapshot.json"));
  const snapshot = buildCatalogSnapshot({
    sourceRef,
    sourceCommit: sourceRef,
    assetRoot,
    sources: [
      { name: "bo", records: parseSource(boSource, "boLandingPromptCases") },
      {
        name: "xhs",
        records: parseSource(xhsSource, "xhsPromptCases"),
        metrics: xhsMetricsSource ? parseObjectSource(xhsMetricsSource, "xhsCaseMetrics") : {},
        metricsRef: xhsMetricsSource || "",
      },
    ],
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(JSON.stringify({
    output,
    catalogVersion: snapshot.catalogVersion,
    checksum: snapshot.checksum,
    counts: snapshot.counts,
    deduplicatedIds: snapshot.deduplicatedIds,
  }, null, 2) + "\n");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
