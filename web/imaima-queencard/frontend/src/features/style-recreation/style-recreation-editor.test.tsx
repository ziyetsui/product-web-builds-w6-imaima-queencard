import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StyleRecreationPattern } from "./pattern-types";
import { StyleRecreationEditor } from "./style-recreation-editor";

const pattern: StyleRecreationPattern = {
  schemaVersion: "pattern/v1", id: "editor-fixture", version: 1, level: "reference", name: "编辑器样例", description: "测试动态字段",
  fillTemplate: "沿用参考作品的木刻、高对比和大留白，创作关于{{topic}}的画面，以{{emotion}}的情绪呈现{{pages}}个瞬间。",
  sourceCaseIds: ["fixture"],
  visualLanguage: { illustration: "木刻", palette: ["黑", "白"], contrast: "high", compositionTendencies: ["单主体"], whitespace: "large", typography: ["顶部标题"], strokeAndTexture: ["粗粝"], visualRhythm: ["强节奏"], emotionalTone: ["压迫"] },
  contentPattern: { hook: "困难", sequence: ["视觉化", "建立关系"], payoff: "共鸣" },
  variables: [
    { key: "topic", label: "新主题", type: "short_text", required: true, maxLength: 30, helpText: "作品要表达什么" },
    { key: "emotion", label: "新情绪", type: "enum", required: true, options: [{ value: "焦虑", label: "焦虑" }, { value: "压迫", label: "压迫" }] },
    { key: "pages", label: "画面数量", type: "number", required: true, min: 1, max: 4 },
  ],
  creativeConstraints: { preserve: ["视觉媒介", "色彩关系"], transform: ["重新设计主体", "重新设计动作", "重新设计场景", "重新设计构图"], forbid: ["复制原文案", "复制原主体", "复制原场景", "复制账号", "复制水印"], create: ["创建新场景", "创建新动作", "创建新空间关系"] },
  review: { reviewer: "审核组", reviewedAt: "2026-08-02", usageRights: "reviewed" },
};

describe("StyleRecreationEditor", () => {
  it("renders one natural sentence with compact slots in reading order", () => {
    const { container } = render(<StyleRecreationEditor pattern={pattern} values={{ topic: "AI 创业", emotion: "焦虑", pages: 3 }} errors={{ topic: "请填写新主题" }} onValueChange={vi.fn()} />);
    const fields = Array.from(container.querySelectorAll("input, select"));
    expect(fields.map((field) => field.getAttribute("aria-label") || field.getAttribute("name"))).toEqual(["新主题", "新情绪", "画面数量"]);
    expect(container).toHaveTextContent("沿用参考作品的木刻、高对比和大留白，创作关于");
    expect(container).toHaveTextContent("的画面，以");
    expect(screen.getByLabelText(/新主题/)).toHaveAttribute("maxlength", "30");
    expect(screen.getByLabelText(/画面数量/)).toHaveAttribute("min", "1");
    expect(screen.getByText("请填写新主题")).toHaveAttribute("id");
    expect(screen.getByLabelText(/新主题/)).toHaveAttribute("aria-describedby", expect.stringContaining("error"));
    expect(screen.queryByText("编辑器样例")).not.toBeInTheDocument();
    expect(screen.queryByText("测试动态字段")).not.toBeInTheDocument();
    expect(screen.queryByText(/继承：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/改变：/)).not.toBeInTheDocument();
  });

  it("updates values without exposing the hidden compiled Prompt", () => {
    const onValueChange = vi.fn();
    render(<StyleRecreationEditor pattern={pattern} values={{ topic: "AI 创业", emotion: "焦虑", pages: 3 }} errors={{}} onValueChange={onValueChange} />);
    fireEvent.change(screen.getByLabelText(/新主题/), { target: { value: "AI 实习生" } });
    expect(onValueChange).toHaveBeenCalledWith("topic", "AI 实习生");
    expect(screen.queryByText("查看发送给模型的完整提示词")).not.toBeInTheDocument();
    expect(screen.queryByText("编译后的隐藏提示词")).not.toBeInTheDocument();
  });
});
