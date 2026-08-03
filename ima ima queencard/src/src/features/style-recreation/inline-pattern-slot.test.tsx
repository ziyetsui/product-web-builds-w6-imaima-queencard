import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PatternVariable } from "./pattern-types";
import { InlinePatternSlot } from "./inline-pattern-slot";

const topic: PatternVariable = { key: "topic", label: "新主题", type: "short_text", required: true, maxLength: 30 };

describe("InlinePatternSlot", () => {
  it("uses compact content width and forwards text edits", () => {
    const onValueChange = vi.fn();
    render(<InlinePatternSlot variable={topic} value="AI 创业" onValueChange={onValueChange} />);
    const input = screen.getByLabelText("新主题");
    expect(input).toHaveStyle({ width: "7em" });
    expect(input).toHaveAttribute("maxlength", "30");
    expect(input).toHaveClass("min-h-11");
    expect(input).toHaveClass("bg-lemon");
    fireEvent.change(input, { target: { value: "一个更长的新主题名称" } });
    expect(onValueChange).toHaveBeenCalledWith("一个更长的新主题名称");
  });

  it("reserves enough visual width for complete CJK values", () => {
    render(<InlinePatternSlot variable={topic} value="程序员加班" onValueChange={vi.fn()} />);
    expect(screen.getByLabelText("新主题")).toHaveStyle({ width: "8.25em" });
  });

  it("renders enum and number constraints inline", () => {
    const emotion: PatternVariable = { key: "emotion", label: "情绪", type: "enum", required: true, options: [{ value: "calm", label: "平静" }, { value: "tense", label: "紧张" }] };
    const pages: PatternVariable = { key: "pages", label: "数量", type: "number", required: true, min: 3, max: 9 };
    const { rerender } = render(<InlinePatternSlot variable={emotion} value="calm" onValueChange={vi.fn()} />);
    expect(screen.getByLabelText("情绪")).toHaveClass("bg-lemon");
    expect(screen.getByLabelText("情绪")).toHaveValue("calm");
    expect(screen.getByRole("option", { name: "平静" })).toBeInTheDocument();
    rerender(<InlinePatternSlot variable={pages} value={6} onValueChange={vi.fn()} />);
    expect(screen.getByLabelText("数量")).toHaveAttribute("min", "3");
    expect(screen.getByLabelText("数量")).toHaveAttribute("max", "9");
  });

  it("associates errors and supports Enter and Escape", () => {
    const onValueChange = vi.fn();
    render(<InlinePatternSlot variable={topic} value="AI 创业" error="请填写新主题" onValueChange={onValueChange} />);
    const input = screen.getByLabelText("新主题");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "topic-error");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "新值" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onValueChange).toHaveBeenLastCalledWith("AI 创业");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).not.toHaveFocus();
  });

  it("uses blue only for variables explicitly classified as visual style", () => {
    const styleVariable: PatternVariable = { ...topic, semanticRole: "visual_style" };
    render(<InlinePatternSlot variable={styleVariable} value="极简线稿" onValueChange={vi.fn()} />);
    expect(screen.getByLabelText("新主题")).toHaveClass("bg-sky/75");
    expect(screen.getByLabelText("新主题")).not.toHaveClass("bg-lemon");
  });
});
