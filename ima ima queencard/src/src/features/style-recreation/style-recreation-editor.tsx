"use client";

import { parseFillTemplate } from "./fill-template";
import { InlinePatternSlot } from "./inline-pattern-slot";
import type { PatternValue, PatternValues, StyleRecreationPattern } from "./pattern-types";

type Props = {
  pattern: StyleRecreationPattern;
  values: PatternValues;
  errors: Record<string, string>;
  onValueChange: (key: string, value: PatternValue) => void;
};

export function StyleRecreationEditor({ pattern, values, errors, onValueChange }: Props) {
  const variablesByKey = new Map(pattern.variables.map((variable) => [variable.key, variable]));
  const activeErrors = pattern.variables
    .map((variable) => ({ key: variable.key, message: errors[variable.key] }))
    .filter((entry): entry is { key: string; message: string } => Boolean(entry.message));

  return (
    <div className="max-w-full rounded-[14px] border border-charcoal/14 bg-canvas-pink/34 px-4 py-4 md:px-5 md:py-5">
      <p className="max-w-full font-manrope text-[16px] font-bold leading-[1.9] text-charcoal md:text-[18px] md:leading-[2]">
        {parseFillTemplate(pattern.fillTemplate).map((segment, index) => {
          if (segment.type === "text") return <span key={`text-${index}`}>{segment.value}</span>;
          const variable = variablesByKey.get(segment.key)!;
          return (
            <InlinePatternSlot
              key={segment.key}
              variable={variable}
              value={values[segment.key] ?? variable.defaultValue ?? ""}
              error={errors[segment.key]}
              onValueChange={(value) => onValueChange(segment.key, value)}
            />
          );
        })}
      </p>
      {activeErrors.length > 0 ? (
        <ul className="mt-3 space-y-1 font-manrope text-[12px] font-bold text-red-700">
          {activeErrors.map((entry) => <li id={`${entry.key}-error`} key={entry.key}>{entry.message}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
