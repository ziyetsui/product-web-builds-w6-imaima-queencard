const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { parseExportedArray, parseExportedObject } = require("../src/source-literal-parser");

const rejectedSource = /export|assignment|direct|literal|terminator|forbidden|invalid/i;

test("finds the real typed export while ignoring string and comment decoys", () => {
  const source = `
const stringDecoy = "export const promptCases = ['string-decoy']";
// export const promptCases = ["line-comment-decoy"];
/* export const promptCases = ["block-comment-decoy"]; */
export const promptCases: XhsPromptCase[] = [
  { id: "real-case", nested: { enabled: true } },
]; // declaration terminator
/* trailing trivia */
`;

  assert.deepEqual(parseExportedArray(source, "promptCases"), [
    { id: "real-case", nested: { enabled: true } },
  ]);
});

test("accepts the current typed object declaration and trailing trivia", () => {
  const source = `
export const caseMetrics: Record<string, XhsCaseMetric> = {
  "case-1": { potentialScore: 12.5, potentialRank: 1 },
};
// trailing trivia is valid
`;

  assert.deepEqual(parseExportedObject(source, "caseMetrics"), {
    "case-1": { potentialScore: 12.5, potentialRank: 1 },
  });
});

test("parses the checked-in source counts without changing source semantics", () => {
  const dataRoot = path.resolve(__dirname, "../template-data");
  const boCases = parseExportedArray(
    fs.readFileSync(path.join(dataRoot, "boLandingPromptCases.ts"), "utf8"),
    "boLandingPromptCases",
  );
  const xhsCases = parseExportedArray(
    fs.readFileSync(path.join(dataRoot, "xhsPromptCases.ts"), "utf8"),
    "xhsPromptCases",
  );
  const metrics = parseExportedObject(
    fs.readFileSync(path.join(dataRoot, "xhsCaseMetrics.ts"), "utf8"),
    "xhsCaseMetrics",
  );

  assert.equal(boCases.length, 2_155);
  assert.equal(xhsCases.length, 122);
  assert.equal(Object.keys(metrics).length, 108);
  assert.equal(boCases.length + xhsCases.length, 2_277);
});

for (const [name, source] of [
  ["string", `const decoy = "export const promptCases = [1]";`],
  ["line comment", `// export const promptCases = [1];`],
  ["block comment", `/* export const promptCases = [1]; */`],
  ["regular expression", `const decoy = /export const promptCases = [1]/;`],
]) {
  test(`does not treat a ${name} as the requested export`, () => {
    assert.throws(() => parseExportedArray(source, "promptCases"), rejectedSource);
  });
}

for (const [name, source] of [
  ["member call", `export const promptCases = [1].map(call);`],
  ["trailing call", `export const promptCases = [1]();`],
  ["trailing statement", `export const promptCases = [1]; call();`],
]) {
  test(`rejects ${name} after the root literal`, () => {
    assert.throws(() => parseExportedArray(source, "promptCases"), rejectedSource);
  });
}

for (const [name, source] of [
  ["spread", `export const promptCases = [...otherCases];`],
  ["getter", `export const promptCases = [{ get id() { return "case-1"; } }];`],
  ["call", `export const promptCases = [makeCase()];`],
  ["member access", `export const promptCases = [fixture.case];`],
  ["identifier", `export const promptCases = [fixture];`],
]) {
  test(`rejects ${name} inside a literal`, () => {
    assert.throws(() => parseExportedArray(source, "promptCases"), rejectedSource);
  });
}

for (const [name, parse, source] of [
  ["top-level __proto__", parseExportedObject, `export const value = { "__proto__": {} };`],
  ["nested prototype", parseExportedObject, `export const value = { safe: { prototype: {} } };`],
  ["nested constructor.prototype", parseExportedObject, `export const value = { safe: [{ constructor: { prototype: {} } }] };`],
  ["array-nested prototype", parseExportedArray, `export const value = [{ safe: [{ prototype: true }] }];`],
]) {
  test(`rejects the forbidden ${name} key`, () => {
    assert.throws(() => parse(source, "value"), /forbidden|__proto__|prototype|constructor/i);
  });
}
