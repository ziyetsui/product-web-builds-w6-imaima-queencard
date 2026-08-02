import { styleRecreationPatterns } from "@/data/styleRecreationPatterns";
import { xhsPromptCases } from "@/data/xhsPromptCases";
import type { PatternValues, StyleRecreationPattern } from "./pattern-types";
import { validateStyleRecreationPattern } from "./pattern-schema";

const patternsById = new Map<string, StyleRecreationPattern>();
const patternsBySourceCase = new Map<string, StyleRecreationPattern>();
const suggestionsBySourceCase = new Map<string, PatternValues>();
const sourceCasesById = new Map(xhsPromptCases.map((sourceCase) => [sourceCase.id, sourceCase]));

export function validateSuggestedPatternValues(pattern: StyleRecreationPattern, values: PatternValues) {
  const expectedKeys = pattern.variables.map((variable) => variable.key).sort();
  const actualKeys = Object.keys(values).sort();
  if (expectedKeys.length !== actualKeys.length || expectedKeys.some((key, index) => key !== actualKeys[index])) {
    return { ok: false as const, message: "suggested Pattern value keys must exactly match variables" };
  }

  for (const variable of pattern.variables) {
    const value = values[variable.key];
    if (variable.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < variable.min || value > variable.max) {
        return { ok: false as const, message: `invalid suggested value: ${variable.key}` };
      }
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      return { ok: false as const, message: `invalid suggested value: ${variable.key}` };
    }
    const length = Array.from(value).length;
    if ((variable.minLength !== undefined && length < variable.minLength) || (variable.maxLength !== undefined && length > variable.maxLength)) {
      return { ok: false as const, message: `invalid suggested value: ${variable.key}` };
    }
    if (variable.type === "enum" && !variable.options.some((option) => option.value === value)) {
      return { ok: false as const, message: `invalid suggested value: ${variable.key}` };
    }
  }

  return { ok: true as const };
}

for (const inputPattern of styleRecreationPatterns) {
  const parsed = validateStyleRecreationPattern(inputPattern);
  if (!parsed.success) throw new Error(`Invalid style recreation Pattern ${inputPattern.id}: ${parsed.error.message}`);
  const pattern = Object.freeze(parsed.data) as StyleRecreationPattern;
  if (patternsById.has(pattern.id)) throw new Error(`Duplicate style recreation Pattern id: ${pattern.id}`);
  patternsById.set(pattern.id, pattern);

  for (const sourceCaseId of pattern.sourceCaseIds) {
    const sourceCase = sourceCasesById.get(sourceCaseId);
    if (!sourceCase) throw new Error(`Unknown source case: ${sourceCaseId}`);
    if (patternsBySourceCase.has(sourceCaseId)) throw new Error(`Duplicate source case binding: ${sourceCaseId}`);
    if (sourceCase.patternId !== pattern.id) throw new Error(`Mismatched Pattern binding for source case: ${sourceCaseId}`);
    const suggestions = sourceCase.suggestedPatternValues;
    if (!suggestions) throw new Error(`Missing suggested Pattern values for source case: ${sourceCaseId}`);
    const suggestionsValidation = validateSuggestedPatternValues(pattern, suggestions);
    if (!suggestionsValidation.ok) throw new Error(`${suggestionsValidation.message} for source case: ${sourceCaseId}`);
    patternsBySourceCase.set(sourceCaseId, pattern);
    suggestionsBySourceCase.set(sourceCaseId, Object.freeze({ ...suggestions }));
  }
}

export function getPatternById(id: string) {
  return patternsById.get(id);
}

export function getPatternForSourceCase(sourceCaseId: string) {
  return patternsBySourceCase.get(sourceCaseId);
}

export function getSuggestedPatternValues(sourceCaseId: string) {
  return suggestionsBySourceCase.get(sourceCaseId);
}

export function getPatternRegistryValidation() {
  return { valid: true as const, patternCount: patternsById.size, sourceBindingCount: patternsBySourceCase.size };
}
