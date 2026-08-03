const JSON5 = require("json5");

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const OPENING_DELIMITERS = new Map([["[", "]"], ["{", "}"], ["(", ")"]]);
const CLOSING_DELIMITERS = new Set(OPENING_DELIMITERS.values());
const REGEX_PREFIX_TOKENS = new Set([
  "(", "[", "{", ",", ":", ";", "=", "!", "?", "+", "-", "*", "%", "&", "|", "^", "~",
  "return", "throw", "case", "delete", "typeof", "void", "new", "in", "of", "yield", "await",
]);

function isIdentifierStart(char) {
  return typeof char === "string" && /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char) {
  return typeof char === "string" && /[A-Za-z0-9_$]/.test(char);
}

function readQuotedToken(sourceText, start, quote) {
  let escaped = false;
  for (let index = start + 1; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === quote) {
      return index + 1;
    }
  }
  throw new Error("Template source string did not terminate");
}

function canStartRegex(previousToken) {
  return !previousToken || REGEX_PREFIX_TOKENS.has(previousToken.value);
}

function readRegexToken(sourceText, start) {
  let escaped = false;
  let inCharacterClass = false;
  for (let index = start + 1; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (char === "\n" || char === "\r") throw new Error("Template source regular expression did not terminate");
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "[") {
      inCharacterClass = true;
    } else if (char === "]") {
      inCharacterClass = false;
    } else if (char === "/" && !inCharacterClass) {
      let end = index + 1;
      while (isIdentifierPart(sourceText[end])) end += 1;
      return end;
    }
  }
  throw new Error("Template source regular expression did not terminate");
}

function tokenize(sourceText) {
  if (typeof sourceText !== "string") throw new TypeError("Template source must be text");

  const tokens = [];
  for (let index = 0; index < sourceText.length;) {
    const char = sourceText[index];
    const next = sourceText[index + 1];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      const newline = sourceText.indexOf("\n", index + 2);
      index = newline < 0 ? sourceText.length : newline + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sourceText.indexOf("*/", index + 2);
      if (end < 0) throw new Error("Template source block comment did not terminate");
      index = end + 2;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      const end = readQuotedToken(sourceText, index, char);
      tokens.push({ type: "string", value: sourceText.slice(index, end), start: index, end });
      index = end;
      continue;
    }
    if (char === "/" && canStartRegex(tokens[tokens.length - 1])) {
      const end = readRegexToken(sourceText, index);
      tokens.push({ type: "regex", value: sourceText.slice(index, end), start: index, end });
      index = end;
      continue;
    }
    if (isIdentifierStart(char)) {
      let end = index + 1;
      while (isIdentifierPart(sourceText[end])) end += 1;
      tokens.push({ type: "identifier", value: sourceText.slice(index, end), start: index, end });
      index = end;
      continue;
    }

    tokens.push({ type: "punctuator", value: char, start: index, end: index + 1 });
    index += 1;
  }
  return tokens;
}

function isIdentifierToken(token, value) {
  return token?.type === "identifier" && token.value === value;
}

function findExportDeclaration(tokens, exportName) {
  if (typeof exportName !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName)) {
    throw new TypeError("Template export name must be an identifier");
  }

  const matches = [];
  const depths = { "(": 0, "[": 0, "{": 0 };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const atTopLevel = depths["("] === 0 && depths["["] === 0 && depths["{"] === 0;
    if (atTopLevel
      && isIdentifierToken(token, "export")
      && isIdentifierToken(tokens[index + 1], "const")
      && isIdentifierToken(tokens[index + 2], exportName)) {
      matches.push(index);
    }

    if (OPENING_DELIMITERS.has(token.value)) {
      depths[token.value] += 1;
    } else if (token.value === ")") {
      depths["("] -= 1;
    } else if (token.value === "]") {
      depths["["] -= 1;
    } else if (token.value === "}") {
      depths["{"] -= 1;
    }
  }

  if (matches.length === 0) throw new Error(`${exportName} export not found`);
  if (matches.length > 1) throw new Error(`${exportName} export is declared more than once`);
  return matches[0];
}

function initializerTokenIndex(tokens, declarationIndex, exportName) {
  let index = declarationIndex + 3;
  if (tokens[index]?.value === ":") {
    index += 1;
    const typeStart = index;
    while (tokens[index] && tokens[index].value !== "=" && tokens[index].value !== ";") index += 1;
    if (index === typeStart) throw new Error(`${exportName} type annotation is empty`);
  }
  if (tokens[index]?.value !== "=") throw new Error(`${exportName} assignment not found`);
  return index + 1;
}

function closingTokenIndex(tokens, openingIndex, exportName, expectedOpening, kind) {
  if (tokens[openingIndex]?.value !== expectedOpening) {
    throw new Error(`${exportName} must be a direct ${kind} literal`);
  }

  const stack = [];
  for (let index = openingIndex; index < tokens.length; index += 1) {
    const value = tokens[index].value;
    if (OPENING_DELIMITERS.has(value)) {
      stack.push(OPENING_DELIMITERS.get(value));
    } else if (CLOSING_DELIMITERS.has(value)) {
      const expected = stack.pop();
      if (value !== expected) throw new Error(`Invalid ${exportName} ${kind} literal delimiters`);
      if (stack.length === 0) return index;
    }
  }
  throw new Error(`${exportName} ${kind} literal did not terminate`);
}

function extractLiteral(sourceText, exportName, expectedOpening, kind) {
  const tokens = tokenize(sourceText);
  const declarationIndex = findExportDeclaration(tokens, exportName);
  const openingIndex = initializerTokenIndex(tokens, declarationIndex, exportName);
  const closingIndex = closingTokenIndex(tokens, openingIndex, exportName, expectedOpening, kind);
  let nextIndex = closingIndex + 1;
  if (tokens[nextIndex]?.value === ";") nextIndex += 1;
  if (nextIndex !== tokens.length) {
    throw new Error(`${exportName} declaration has an invalid trailing expression or statement`);
  }
  return sourceText.slice(tokens[openingIndex].start, tokens[closingIndex].end);
}

function assertRestrictedValue(value, exportName, path = exportName) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`${exportName} contains an invalid non-finite number at ${path}`);
  }
  if (!value || typeof value !== "object") return;

  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`${exportName} contains forbidden key ${key} at ${path}`);
    }
    if (!("value" in descriptor)) {
      throw new Error(`${exportName} contains a forbidden accessor at ${path}.${key}`);
    }
    assertRestrictedValue(descriptor.value, exportName, `${path}.${key}`);
  }
}

function parseLiteral(literal, exportName, kind) {
  let value;
  try {
    value = JSON5.parse(literal);
  } catch (error) {
    throw new Error(`Invalid ${exportName} ${kind} literal: ${error.message}`);
  }
  assertRestrictedValue(value, exportName);
  return value;
}

function parseExportedArray(sourceText, exportName) {
  const value = parseLiteral(extractLiteral(sourceText, exportName, "[", "array"), exportName, "array");
  if (!Array.isArray(value)) throw new Error(`${exportName} must be an array literal`);
  return value;
}

function parseExportedObject(sourceText, exportName) {
  const value = parseLiteral(extractLiteral(sourceText, exportName, "{", "object"), exportName, "object");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${exportName} must be an object literal`);
  return value;
}

module.exports = {
  parseExportedArray,
  parseExportedObject,
};
