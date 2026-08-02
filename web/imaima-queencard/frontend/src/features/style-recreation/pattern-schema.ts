import { z } from "zod";
import { validateFillTemplate } from "./fill-template";

const nonEmpty = z.string().trim().min(1);
const stringList = z.array(nonEmpty).min(1);
const variableBase = {
  key: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  label: nonEmpty,
  helpText: nonEmpty.optional(),
  required: z.boolean(),
  placeholder: nonEmpty.optional(),
};

const shortTextVariable = z.object({
  ...variableBase,
  type: z.literal("short_text"),
  defaultValue: z.string().optional(),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().positive().max(60).optional(),
}).superRefine((value, context) => {
  if (value.minLength !== undefined && value.maxLength !== undefined && value.minLength > value.maxLength) {
    context.addIssue({ code: "custom", message: "minLength must not exceed maxLength" });
  }
});

const longTextVariable = z.object({
  ...variableBase,
  type: z.literal("long_text"),
  defaultValue: z.string().optional(),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().positive().max(300).optional(),
}).superRefine((value, context) => {
  if (value.minLength !== undefined && value.maxLength !== undefined && value.minLength > value.maxLength) {
    context.addIssue({ code: "custom", message: "minLength must not exceed maxLength" });
  }
});

const enumVariable = z.object({
  ...variableBase,
  type: z.literal("enum"),
  defaultValue: z.string().optional(),
  options: z.array(z.object({ value: nonEmpty, label: nonEmpty })).min(2).max(12),
}).superRefine((value, context) => {
  if (new Set(value.options.map((option) => option.value)).size !== value.options.length) {
    context.addIssue({ code: "custom", message: "enum option values must be unique" });
  }
  if (value.defaultValue !== undefined && !value.options.some((option) => option.value === value.defaultValue)) {
    context.addIssue({ code: "custom", message: "enum default must be an option" });
  }
});

const numberVariable = z.object({
  ...variableBase,
  type: z.literal("number"),
  defaultValue: z.number().finite().optional(),
  min: z.number().finite(),
  max: z.number().finite(),
}).superRefine((value, context) => {
  if (value.min > value.max) context.addIssue({ code: "custom", message: "min must not exceed max" });
  if (value.defaultValue !== undefined && (value.defaultValue < value.min || value.defaultValue > value.max)) {
    context.addIssue({ code: "custom", message: "number default is out of range" });
  }
});

export const patternVariableSchema = z.union([
  shortTextVariable,
  longTextVariable,
  enumVariable,
  numberVariable,
]);

function includesAll(values: string[], words: string[]) {
  return words.every((word) => values.some((value) => value.includes(word)));
}

export const styleRecreationPatternSchema = z.object({
  schemaVersion: z.literal("pattern/v1"),
  id: z.string().regex(/^[a-z0-9-]{3,64}$/),
  version: z.number().int().min(1),
  level: z.enum(["reference", "series"]),
  name: nonEmpty,
  description: nonEmpty,
  fillTemplate: nonEmpty,
  sourceCaseIds: z.array(nonEmpty).min(1),
  visualLanguage: z.object({
    illustration: nonEmpty,
    palette: stringList,
    contrast: z.enum(["low", "medium", "high"]),
    compositionTendencies: stringList,
    whitespace: z.enum(["small", "medium", "large"]),
    typography: stringList,
    strokeAndTexture: stringList,
    visualRhythm: stringList,
    emotionalTone: stringList,
  }),
  contentPattern: z.object({
    hook: nonEmpty,
    sequence: z.array(nonEmpty).min(2).max(8),
    payoff: nonEmpty,
  }),
  variables: z.array(patternVariableSchema).min(3).max(4),
  creativeConstraints: z.object({
    preserve: stringList,
    transform: stringList,
    forbid: stringList,
    create: stringList,
  }),
  review: z.object({
    reviewer: nonEmpty,
    reviewedAt: z.iso.date(),
    usageRights: z.literal("reviewed"),
  }),
}).superRefine((pattern, context) => {
  const keys = pattern.variables.map((variable) => variable.key);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", message: "variable keys must be unique", path: ["variables"] });
  if (pattern.variables.some((variable) => variable.type === "long_text")) {
    context.addIssue({ code: "custom", message: "inline Pattern variables cannot use long_text", path: ["variables"] });
  }
  const fillTemplate = validateFillTemplate(pattern.fillTemplate, pattern.variables);
  if (fillTemplate.ok === false) context.addIssue({ code: "custom", message: fillTemplate.message, path: ["fillTemplate"] });
  if (pattern.variables.filter((variable) => variable.required).length > 5) {
    context.addIssue({ code: "custom", message: "at most five variables may be required", path: ["variables"] });
  }
  const topics = pattern.variables.filter((variable) => variable.key === "topic");
  if (topics.length !== 1 || topics[0]?.type !== "short_text" || !topics[0].required || topics[0].defaultValue !== undefined) {
    context.addIssue({ code: "custom", message: "topic must be one required default-free short_text", path: ["variables"] });
  }
  if (!includesAll(pattern.creativeConstraints.transform, ["主体", "动作", "场景", "构图"])) {
    context.addIssue({ code: "custom", message: "transform rules must cover subject, action, scene and composition", path: ["creativeConstraints", "transform"] });
  }
  if (!includesAll(pattern.creativeConstraints.forbid, ["原文案", "原主体", "原场景", "账号", "水印"])) {
    context.addIssue({ code: "custom", message: "forbid rules are incomplete", path: ["creativeConstraints", "forbid"] });
  }
  if (!includesAll(pattern.creativeConstraints.create, ["新场景", "新动作", "新空间关系"])) {
    context.addIssue({ code: "custom", message: "create rules are incomplete", path: ["creativeConstraints", "create"] });
  }
});

export function validateStyleRecreationPattern(input: unknown) {
  return styleRecreationPatternSchema.safeParse(input);
}
