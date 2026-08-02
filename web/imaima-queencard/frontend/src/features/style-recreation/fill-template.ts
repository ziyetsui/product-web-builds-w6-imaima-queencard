import type { PatternVariable } from "./pattern-types";

export type FillTemplateSegment =
  | { type: "text"; value: string }
  | { type: "slot"; key: string };

const SLOT_PATTERN = /\{\{([a-z][a-z0-9_]{1,31})\}\}/g;

export function parseFillTemplate(template: string): FillTemplateSegment[] {
  const segments: FillTemplateSegment[] = [];
  let cursor = 0;

  for (const match of template.matchAll(SLOT_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ type: "text", value: template.slice(cursor, index) });
    segments.push({ type: "slot", key: match[1]! });
    cursor = index + match[0].length;
  }

  if (cursor < template.length) segments.push({ type: "text", value: template.slice(cursor) });
  return segments;
}

function maximumVariableLength(variable: PatternVariable) {
  if (variable.type === "number") {
    return Math.max(Array.from(String(variable.min)).length, Array.from(String(variable.max)).length);
  }
  if (variable.type === "enum") {
    return Math.max(...variable.options.map((option) =>
      Math.max(Array.from(option.value).length, Array.from(option.label).length)),
    );
  }
  return variable.maxLength ?? (variable.type === "long_text" ? 300 : 60);
}

export function validateFillTemplate(template: string, variables: PatternVariable[]):
  | { ok: true; segments: FillTemplateSegment[] }
  | { ok: false; message: string } {
  const segments = parseFillTemplate(template);
  const text = segments.filter((segment) => segment.type === "text").map((segment) => segment.value).join("");
  if (text.includes("{{") || text.includes("}}")) return { ok: false, message: "fillTemplate contains a malformed slot" };

  const variablesByKey = new Map(variables.map((variable) => [variable.key, variable]));
  const slotKeys = segments.filter((segment) => segment.type === "slot").map((segment) => segment.key);
  for (const key of slotKeys) {
    if (!variablesByKey.has(key)) return { ok: false, message: `fillTemplate references unknown variable: ${key}` };
    if (slotKeys.filter((slotKey) => slotKey === key).length !== 1) {
      return { ok: false, message: `fillTemplate repeats variable: ${key}` };
    }
  }
  for (const variable of variables) {
    if (!slotKeys.includes(variable.key)) return { ok: false, message: `fillTemplate omits variable: ${variable.key}` };
  }

  const maximumLength = segments.reduce((length, segment) => {
    if (segment.type === "text") return length + Array.from(segment.value).length;
    return length + maximumVariableLength(variablesByKey.get(segment.key)!);
  }, 0);
  if (maximumLength > 220) return { ok: false, message: "fillTemplate exceeds 220 code points at maximum values" };

  return { ok: true, segments };
}
