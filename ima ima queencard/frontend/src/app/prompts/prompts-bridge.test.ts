import { describe, expect, it } from "vitest";

import { xhsPromptCases } from "@/data/xhsPromptCases";

import { buildCaseTryUrl } from "./build-case-try-url";

describe("Prompt Library external bridge", () => {
  it("maps prompt case metadata into generated URL source fields", () => {
    const item = xhsPromptCases[0]!;
    const url = new URL(buildCaseTryUrl(item, item.prompt));

    expect(url.origin).toBe("https://imaimaqueencard.com");
    expect(url.pathname).toBe("/generated");
    expect(url.searchParams.get("template")).toBe(item.id);
    expect(url.searchParams.get("source_case_id")).toBe(item.id);
    expect(url.searchParams.get("source_case_category")).toBe(item.category);
    expect(url.searchParams.get("note_url")).toBe(item.noteUrl);
    expect(url.searchParams.get("author_url")).toBe(item.authorUrl);
    expect(url.searchParams.get("source_note_url")).toBe(
      "https://www.xiaohongshu.com/explore/68e7953a00000000070087cc"
    );
    expect(url.searchParams.get("source_author_url")).toBe(
      "https://www.xiaohongshu.com/user/profile/61f8dc6700000000210268d9"
    );
  });
});
