const JSON5 = require("json5");

function exportAssignmentIndex(sourceText, exportName) {
  if (typeof sourceText !== "string") throw new TypeError("Template source must be text");
  const escapedName = exportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declaration = new RegExp(`\\bexport\\s+const\\s+${escapedName}\\b`).exec(sourceText);
  if (!declaration) throw new Error(`${exportName} export not found`);
  const equalsIndex = sourceText.indexOf("=", declaration.index + declaration[0].length);
  if (equalsIndex < 0) throw new Error(`${exportName} assignment not found`);
  return equalsIndex;
}

function skipTrivia(sourceText, start) {
  let index = start;
  while (index < sourceText.length) {
    if (/\s/.test(sourceText[index])) {
      index += 1;
      continue;
    }
    if (sourceText[index] === "/" && sourceText[index + 1] === "/") {
      index = sourceText.indexOf("\n", index + 2);
      if (index < 0) return sourceText.length;
      continue;
    }
    if (sourceText[index] === "/" && sourceText[index + 1] === "*") {
      const end = sourceText.indexOf("*/", index + 2);
      if (end < 0) throw new Error("Template source block comment did not terminate");
      index = end + 2;
      continue;
    }
    break;
  }
  return index;
}

function extractDelimitedLiteral(sourceText, exportName, opening, closing, kind) {
  const equalsIndex = exportAssignmentIndex(sourceText, exportName);
  const start = skipTrivia(sourceText, equalsIndex + 1);
  if (sourceText[start] !== opening) throw new Error(`${exportName} must be a direct ${kind} literal`);

  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    const next = sourceText[index + 1];
    if (lineComment) {
      if (char === "\n" || char === "\r") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) return sourceText.slice(start, index + 1);
    }
  }
  throw new Error(`${exportName} ${kind} literal did not terminate`);
}

function parseLiteral(literal, exportName, kind) {
  try {
    return JSON5.parse(literal);
  } catch (error) {
    throw new Error(`Invalid ${exportName} ${kind} literal: ${error.message}`);
  }
}

function parseExportedArray(sourceText, exportName) {
  const value = parseLiteral(extractDelimitedLiteral(sourceText, exportName, "[", "]", "array"), exportName, "array");
  if (!Array.isArray(value)) throw new Error(`${exportName} must be an array literal`);
  return value;
}

function parseExportedObject(sourceText, exportName) {
  const value = parseLiteral(extractDelimitedLiteral(sourceText, exportName, "{", "}", "object"), exportName, "object");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${exportName} must be an object literal`);
  return value;
}

module.exports = {
  parseExportedArray,
  parseExportedObject,
};
