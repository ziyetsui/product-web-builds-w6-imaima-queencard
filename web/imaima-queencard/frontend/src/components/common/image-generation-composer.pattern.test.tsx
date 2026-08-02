import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageGenerationComposer } from "./image-generation-composer";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("ImageGenerationComposer Pattern mode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { taskId: "task-1", redirectUrl: "/generated?taskId=task-1" } }),
    }));
  });

  it("prefills reviewed suggestions and submits edits through the hidden compiler", async () => {
    render(<ImageGenerationComposer
      seed={{ source: "prompt-library", templateId: "20251009-27", sourceCaseId: "20251009-27", patternId: "wordplay-reveal-1", referenceImages: ["/reference.jpg"] }}
      showHeader={false}
      frameless
      layout="compact"
    />);
    expect(screen.getByLabelText("新主题")).toHaveValue("AI 创业");
    expect(screen.getByLabelText("新情境")).toHaveValue("程序员加班");
    expect(screen.getByLabelText("新包袱")).toHaveValue("模型又崩了");
    expect(screen.getByRole("button", { name: "生成" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("新包袱"), { target: { value: "AI 反过来给导师写绩效评价" } });
    expect(screen.queryByLabelText("新标题")).not.toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "生成" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const request = vi.mocked(fetch).mock.calls[0]![1]!;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({ templateId: "20251009-27", sourceCaseId: "20251009-27", referenceImages: ["/reference.jpg"] });
    expect(body.prompt).toContain("【创作任务】");
    expect(body.prompt).toContain("- 新主题：AI 创业");
    expect(body.prompt).toContain("- 新包袱：AI 反过来给导师写绩效评价");
    expect(body.prompt).not.toContain("模型又崩了");
    expect(body.prompt).not.toContain("逐项复刻原图");
  });

  it("restores a same-version draft before case suggestions", async () => {
    window.localStorage.setItem("inline-pattern-draft", JSON.stringify({
      prompt: "",
      referenceImages: ["/reference.jpg"],
      patternId: "wordplay-reveal-1",
      patternVersion: 1,
      patternValues: { topic: "宠物开会", setup: "猫咪主持晨会", punchline: "狗把会议纪要吃了" },
    }));
    render(<ImageGenerationComposer
      seed={{ source: "prompt-library", templateId: "20251009-27", sourceCaseId: "20251009-27", patternId: "wordplay-reveal-1", referenceImages: ["/reference.jpg"] }}
      draftStorageKey="inline-pattern-draft"
      showHeader={false}
      frameless
      layout="compact"
    />);
    await waitFor(() => expect(screen.getByLabelText("新主题")).toHaveValue("宠物开会"));
    expect(screen.getByLabelText("新情境")).toHaveValue("猫咪主持晨会");
    expect(screen.getByLabelText("新包袱")).toHaveValue("狗把会议纪要吃了");
  });

  it("keeps Manual mode as an editable free-text prompt", () => {
    render(<ImageGenerationComposer seed={{ source: "manual", prompt: "一张温柔海报", referenceImages: ["/reference.jpg"] }} showHeader={false} frameless layout="compact" />);
    expect(screen.getByDisplayValue("一张温柔海报")).toBeEnabled();
    expect(screen.queryByText(/继承：/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成" })).toBeEnabled();
  });

  it("does not fall back when a library case has no known Pattern", () => {
    render(<ImageGenerationComposer seed={{ source: "prompt-library", patternId: "missing-pattern", prompt: "legacy prompt", referenceImages: ["/reference.jpg"] }} showHeader={false} frameless layout="compact" />);
    expect(screen.getByText("模板准备中")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("legacy prompt")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成" })).toBeDisabled();
  });
});
