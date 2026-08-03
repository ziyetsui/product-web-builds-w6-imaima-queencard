import { describe, expect, it } from "vitest";

import {
  addReferenceImageToDraft,
  buildGeneratedDraftStorageKey,
  loadComposerDraft,
  mergeQuotedPrompt,
  mergeComposerDraftIntoSeed,
  readRailCollapsedPreference,
  restorePatternDraft,
  saveComposerDraft,
  shouldAskPromptReuseChoice,
  writeRailCollapsedPreference,
} from "./workspace-state";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial));

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("generated workspace state helpers", () => {
  it("uses task-specific draft keys before generic manual drafts", () => {
    expect(buildGeneratedDraftStorageKey({ taskId: "gen_123" })).toBe(
      "imaima.generated.draft.task:gen_123"
    );
    expect(
      buildGeneratedDraftStorageKey({
        sourceCaseId: "case_42",
        source: "prompt-library",
      })
    ).toBe("imaima.generated.draft.case:case_42");
    expect(buildGeneratedDraftStorageKey({ source: "manual" })).toBe(
      "imaima.generated.draft.manual"
    );
  });

  it("round-trips composer draft data with normalized reference images", () => {
    const storage = memoryStorage();
    saveComposerDraft(storage, "draft-key", {
      prompt: "make a soft poster",
      referenceImages: ["a.png", "a.png", "", "b.png", "c.png", "d.png"],
      model: "gpt-image-2-edit",
      aspectRatio: "3:4",
      outputCount: 4,
      resolution: "auto",
      aiEnhance: true,
      fastMode: false,
    });

    expect(loadComposerDraft(storage, "draft-key")).toEqual({
      prompt: "make a soft poster",
      referenceImages: ["a.png", "b.png", "c.png"],
      model: "gpt-image-2-edit",
      aspectRatio: "3:4",
      outputCount: 4,
      resolution: "auto",
      aiEnhance: true,
      fastMode: false,
    });
  });

  it("round-trips primitive Pattern values without changing manual drafts", () => {
    const storage = memoryStorage();
    saveComposerDraft(storage, "pattern", {
      prompt: "compiled prompt",
      referenceImages: ["one.png"],
      patternId: "visual-metaphor-emotion-1",
      patternVersion: 1,
      patternValues: { topic: "创业", subject: "年轻人", pages: 4, ignored: true as never },
    });
    expect(loadComposerDraft(storage, "pattern")).toMatchObject({
      patternId: "visual-metaphor-emotion-1",
      patternVersion: 1,
      patternValues: { topic: "创业", subject: "年轻人", pages: 4 },
    });

    const manual = { prompt: "manual", referenceImages: [] };
    saveComposerDraft(storage, "manual", manual);
    expect(loadComposerDraft(storage, "manual")).toEqual(manual);
  });

  it("migrates only same-key, same-type valid values when a Pattern version changes", () => {
    const restored = restorePatternDraft(
      {
        id: "example",
        version: 2,
        variables: [
          { key: "topic", type: "short_text", required: true, maxLength: 20 },
          { key: "pages", type: "number", required: false, min: 3, max: 9 },
          { key: "tone", type: "enum", required: false, options: [{ value: "温柔", label: "温柔" }] },
        ],
      },
      { patternId: "example", patternVersion: 1, patternValues: { topic: "新主题", pages: "6", tone: "激烈", removed: "x" } },
    );
    expect(restored).toEqual({ values: { topic: "新主题" }, patternUpdated: true });
  });

  it("merges restored composer drafts into the workspace seed", () => {
    expect(
      mergeComposerDraftIntoSeed(
        {
          prompt: "",
          referenceImages: [],
          title: "图生图生成",
          source: "manual",
        },
        {
          prompt: "restored prompt",
          referenceImages: ["one.png", "two.png"],
          model: "gpt-image-2-edit",
          aspectRatio: "3:4",
          outputCount: 2,
          resolution: "auto",
          aiEnhance: false,
          fastMode: true,
        }
      )
    ).toEqual({
      prompt: "restored prompt",
      referenceImages: ["one.png", "two.png"],
      title: "图生图生成",
      source: "manual",
      model: "gpt-image-2-edit",
      aspectRatio: "3:4",
      outputCount: 2,
      resolution: "auto",
      aiEnhance: false,
      fastMode: true,
    });
  });

  it("ignores invalid persisted composer drafts", () => {
    const storage = memoryStorage({ broken: "{ nope" });
    expect(loadComposerDraft(storage, "broken")).toBeNull();
    expect(loadComposerDraft(storage, "missing")).toBeNull();
  });

  it("requires an explicit prompt choice only when current text would be replaced", () => {
    expect(shouldAskPromptReuseChoice("", "quoted")).toBe(false);
    expect(shouldAskPromptReuseChoice("quoted", "quoted")).toBe(false);
    expect(shouldAskPromptReuseChoice("current", "quoted")).toBe(true);

    expect(mergeQuotedPrompt("current", "quoted", "append")).toBe(
      "current\n\nquoted"
    );
    expect(mergeQuotedPrompt("current", "quoted", "overwrite")).toBe("quoted");
  });

  it("asks for replacement instead of silently dropping a fourth reference image", () => {
    expect(addReferenceImageToDraft(["one"], "two")).toEqual({
      status: "added",
      referenceImages: ["one", "two"],
    });
    expect(addReferenceImageToDraft(["one", "two", "three"], "four")).toEqual({
      status: "needs-replacement",
      referenceImages: ["one", "two", "three"],
    });
    expect(addReferenceImageToDraft(["one", "two", "three"], "four", 1)).toEqual({
      status: "replaced",
      referenceImages: ["one", "four", "three"],
    });
  });

  it("persists the rail collapse preference", () => {
    const storage = memoryStorage();
    expect(readRailCollapsedPreference(storage)).toBeNull();

    writeRailCollapsedPreference(storage, true);
    expect(readRailCollapsedPreference(storage)).toBe(true);

    writeRailCollapsedPreference(storage, false);
    expect(readRailCollapsedPreference(storage)).toBe(false);
  });
});
