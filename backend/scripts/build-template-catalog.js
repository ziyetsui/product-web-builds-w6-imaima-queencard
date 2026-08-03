#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { buildCatalogSnapshot } = require("../src/services/catalog-service");
const { parseExportedArray, parseExportedObject } = require("../src/source-literal-parser");

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
  return parseExportedArray(readSource(value), exportName);
}

function parseObjectSource(value, exportName) {
  return parseExportedObject(readSource(value), exportName);
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
