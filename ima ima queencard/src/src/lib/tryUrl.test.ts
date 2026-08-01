import { describe, expect, it } from "vitest";

import { buildPromptTryUrl, DEFAULT_TRY_URL } from "./tryUrl";

function parseTryUrl(url: string) {
  return new URL(url);
}

describe("buildPromptTryUrl", () => {
  it("returns the external generated URL with default visual parameters", () => {
    const url = parseTryUrl(buildPromptTryUrl());

    expect(url.origin).toBe("https://imaimaqueencard.com");
    expect(url.pathname).toBe("/generated");
    expect(url.searchParams.get("type")).toBe("visual-explainer");
    expect(url.searchParams.get("ai_polish")).toBe("0");
    expect(DEFAULT_TRY_URL).toBe(
      "https://imaimaqueencard.com/generated?type=visual-explainer&ai_polish=0"
    );
  });

  it("writes prompt compatibility fields", () => {
    const url = parseTryUrl(buildPromptTryUrl({ prompt: "做一张爆款封面" }));

    for (const key of ["prompt", "input", "value", "topic", "default_prompt"]) {
      expect(url.searchParams.get(key)).toBe("做一张爆款封面");
    }
  });

  it("normalizes, deduplicates, and limits reference images to three", () => {
    const url = parseTryUrl(
      buildPromptTryUrl({
        referenceImages: [
          "/xhs-cases/a.jpg",
          "/xhs-cases/a.jpg",
          "/xhs-cases/b.jpg",
          "https://cdn.example.com/c.jpg",
          "/xhs-cases/d.jpg",
        ],
      })
    );
    const images = JSON.parse(url.searchParams.get("reference_images") ?? "[]");

    expect(images).toEqual([
      "https://imaimaqueencard.com/xhs-cases/a.jpg",
      "https://imaimaqueencard.com/xhs-cases/b.jpg",
      "https://cdn.example.com/c.jpg",
    ]);
    expect(url.searchParams.get("reference_image_count")).toBe("3");
  });

  it("sets source note and author URLs", () => {
    const url = parseTryUrl(
      buildPromptTryUrl({
        noteUrl: "https://www.xiaohongshu.com/explore/note",
        authorUrl: "https://www.xiaohongshu.com/user/profile/author",
      })
    );

    expect(url.searchParams.get("note_url")).toBe(
      "https://www.xiaohongshu.com/explore/note"
    );
    expect(url.searchParams.get("author_url")).toBe(
      "https://www.xiaohongshu.com/user/profile/author"
    );
  });

  it("appends source case metadata without removing legacy URL fields", () => {
    const url = parseTryUrl(
      buildPromptTryUrl({
        templateId: "case-001",
        noteUrl: "https://www.xiaohongshu.com/explore/note?xsec_token=legacy",
        authorUrl: "https://www.xiaohongshu.com/user/profile/author?xsec_token=legacy",
        sourceCaseId: "case-001",
        sourceCaseCategory: "搞笑漫画",
        sourceNoteUrl: "https://www.xiaohongshu.com/explore/note?xsec_token=source#detail",
        sourceAuthorUrl: "https://www.xiaohongshu.com/user/profile/author?xsec_token=source#detail",
      })
    );

    expect(url.searchParams.get("template")).toBe("case-001");
    expect(url.searchParams.get("note_url")).toBe(
      "https://www.xiaohongshu.com/explore/note?xsec_token=legacy"
    );
    expect(url.searchParams.get("author_url")).toBe(
      "https://www.xiaohongshu.com/user/profile/author?xsec_token=legacy"
    );
    expect(url.searchParams.get("source_case_id")).toBe("case-001");
    expect(url.searchParams.get("source_case_category")).toBe("搞笑漫画");
    expect(url.searchParams.get("source_note_url")).toBe(
      "https://www.xiaohongshu.com/explore/note"
    );
    expect(url.searchParams.get("source_author_url")).toBe(
      "https://www.xiaohongshu.com/user/profile/author"
    );
  });

  it("derives sanitized source URLs from legacy URLs when source URLs are omitted", () => {
    const url = parseTryUrl(
      buildPromptTryUrl({
        noteUrl: "https://www.xiaohongshu.com/explore/fallback-note?xsec_token=abc",
        authorUrl: "https://www.xiaohongshu.com/user/profile/fallback-author?xsec_token=abc",
      })
    );

    expect(url.searchParams.get("source_note_url")).toBe(
      "https://www.xiaohongshu.com/explore/fallback-note"
    );
    expect(url.searchParams.get("source_author_url")).toBe(
      "https://www.xiaohongshu.com/user/profile/fallback-author"
    );
  });

  it("sets parseable generation payload aliases", () => {
    const url = parseTryUrl(buildPromptTryUrl({ prompt: "测试 prompt" }));

    for (const key of ["generation_payload", "payload", "config"]) {
      const payload = JSON.parse(url.searchParams.get(key) ?? "{}");
      expect(payload.input).toBe("测试 prompt");
      expect(payload.skill_name).toBe("baoyu-infographic");
      expect(Array.isArray(payload.reference_images)).toBe(true);
    }
  });
});
