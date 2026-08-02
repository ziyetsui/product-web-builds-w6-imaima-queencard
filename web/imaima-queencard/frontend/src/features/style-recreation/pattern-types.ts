export type PatternLevel = "reference" | "series";
export type PatternVariableType = "short_text" | "long_text" | "enum" | "number";
export type PatternValue = string | number;
export type PatternValues = Record<string, PatternValue>;

export type PatternVariable = {
  key: string;
  label: string;
  helpText?: string;
  type: PatternVariableType;
  required: boolean;
  defaultValue?: PatternValue;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
};

export type StyleRecreationPattern = {
  schemaVersion: "pattern/v1";
  id: string;
  version: number;
  level: PatternLevel;
  name: string;
  description: string;
  fillTemplate: string;
  sourceCaseIds: string[];
  visualLanguage: {
    illustration: string;
    palette: string[];
    contrast: "low" | "medium" | "high";
    compositionTendencies: string[];
    whitespace: "small" | "medium" | "large";
    typography: string[];
    strokeAndTexture: string[];
    visualRhythm: string[];
    emotionalTone: string[];
  };
  contentPattern: { hook: string; sequence: string[]; payoff: string };
  variables: PatternVariable[];
  creativeConstraints: {
    preserve: string[];
    transform: string[];
    forbid: string[];
    create: string[];
  };
  review: {
    reviewer: string;
    reviewedAt: string;
    usageRights: "reviewed";
  };
};

export type StyleRecreationCompileErrorCode =
  | "PATTERN_NOT_FOUND"
  | "INVALID_PATTERN"
  | "MISSING_REQUIRED_VARIABLE"
  | "INVALID_VARIABLE_TYPE"
  | "INVALID_VARIABLE_VALUE"
  | "UNKNOWN_VARIABLE"
  | "PROMPT_TOO_LONG";

export type CompileStyleRecreationPromptResult =
  | {
      ok: true;
      value: {
        patternId: string;
        patternVersion: number;
        prompt: string;
        characterCount: number;
      };
    }
  | {
      ok: false;
      error: {
        code: StyleRecreationCompileErrorCode;
        message: string;
        patternId?: string;
        fieldKey?: string;
      };
    };
