"use client";

import { useRef } from "react";

import { cn } from "@/lib/utils";
import type { PatternValue, PatternVariable } from "./pattern-types";

type Props = {
  variable: PatternVariable;
  value: PatternValue;
  error?: string;
  toneIndex: number;
  onValueChange: (value: PatternValue) => void;
};

function widthInCharacters(value: string) {
  return `${Math.min(26, Math.max(8, Array.from(value).length + 2))}ch`;
}

export function InlinePatternSlot({ variable, value, error, toneIndex, onValueChange }: Props) {
  const focusedValue = useRef<PatternValue>(value);
  const errorId = `${variable.key}-error`;
  const displayedValue = variable.type === "enum"
    ? variable.options.find((option) => option.value === value)?.label ?? String(value)
    : String(value);
  const common = {
    id: variable.key,
    name: variable.key,
    "aria-label": variable.label,
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? errorId : undefined,
    onFocus: () => { focusedValue.current = value; },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") {
        event.preventDefault();
        onValueChange(focusedValue.current);
        event.currentTarget.blur();
      }
    },
    style: { width: widthInCharacters(displayedValue) },
    className: cn(
      "mx-1 inline-flex min-h-11 max-w-full align-middle whitespace-nowrap rounded-[4px] border-0 border-b-[3px] border-charcoal px-2 font-manrope text-[16px] font-black leading-none text-charcoal shadow-brand-sm outline-none transition-[width,box-shadow] focus-visible:ring-2 focus-visible:ring-charcoal focus-visible:ring-offset-2",
      toneIndex % 2 === 0 ? "bg-lemon" : "bg-sky/75",
      error && "border-red-700 ring-2 ring-red-700/30",
    ),
  };

  if (variable.type === "enum") {
    return (
      <select {...common} value={String(value)} onChange={(event) => onValueChange(event.target.value)}>
        {variable.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }

  return (
    <input
      {...common}
      type={variable.type === "number" ? "number" : "text"}
      value={value}
      min={variable.type === "number" ? variable.min : undefined}
      max={variable.type === "number" ? variable.max : undefined}
      minLength={variable.type === "short_text" ? variable.minLength : undefined}
      maxLength={variable.type === "short_text" ? variable.maxLength : undefined}
      onChange={(event) => onValueChange(variable.type === "number"
        ? event.target.value === "" ? "" : Number(event.target.value)
        : event.target.value)}
    />
  );
}
