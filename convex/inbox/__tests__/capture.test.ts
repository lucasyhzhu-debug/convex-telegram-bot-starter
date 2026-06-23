// convex/inbox/__tests__/capture.test.ts
//
// Pure-function tests for parseCapture and detectKind.
// Mirrors the style of webhook.test.ts and telegramHtml.test.ts:
// no Convex runtime, no fetch mocks — just logic.

import { describe, it, expect } from "vitest";
import { parseCapture, detectKind } from "../capture";

// ─── detectKind ──────────────────────────────────────────────────────────────

describe("detectKind", () => {
  it("classifies youtube.com URLs as youtube", () => {
    expect(detectKind("https://www.youtube.com/watch?v=abc123")).toBe("youtube");
  });

  it("classifies youtu.be short links as youtube", () => {
    expect(detectKind("https://youtu.be/abc123")).toBe("youtube");
  });

  it("classifies generic https URLs as url", () => {
    expect(detectKind("https://example.com/article")).toBe("url");
  });

  it("classifies http URLs as url", () => {
    expect(detectKind("http://example.com")).toBe("url");
  });

  it("classifies plain text as text", () => {
    expect(detectKind("remember to read more about RAG")).toBe("text");
  });

  it("classifies text with no protocol as text", () => {
    expect(detectKind("example.com")).toBe("text");
  });
});

// ─── parseCapture ────────────────────────────────────────────────────────────

describe("parseCapture — default category", () => {
  it("defaults category to 'inbox' for plain text", () => {
    const r = parseCapture("just some note");
    expect(r.category).toBe("inbox");
    expect(r.source).toBe("just some note");
    expect(r.kind).toBe("text");
  });

  it("defaults category to 'inbox' for a URL with no directive", () => {
    const r = parseCapture("https://example.com");
    expect(r.category).toBe("inbox");
    expect(r.source).toBe("https://example.com");
    expect(r.kind).toBe("url");
  });
});

describe("parseCapture — 'under <category>' prefix", () => {
  it("extracts category from 'under X <rest>'", () => {
    const r = parseCapture("under recipes https://cooking.com/pasta");
    expect(r.category).toBe("recipes");
    expect(r.source).toBe("https://cooking.com/pasta");
    expect(r.kind).toBe("url");
  });

  it("is case-insensitive for the 'under' keyword", () => {
    const r = parseCapture("UNDER Research some note");
    expect(r.category).toBe("research");
    expect(r.source).toBe("some note");
  });

  it("lowercases the category", () => {
    const r = parseCapture("under MyTopic note");
    expect(r.category).toBe("mytopic");
  });

  it("handles youtube URL under a category", () => {
    const r = parseCapture("under learning https://youtu.be/abc");
    expect(r.category).toBe("learning");
    expect(r.kind).toBe("youtube");
  });

  it("'under' without subsequent text does NOT match (falls through to default)", () => {
    // "under" alone has no capture group match
    const r = parseCapture("under");
    expect(r.category).toBe("inbox");
    expect(r.source).toBe("under");
  });
});

describe("parseCapture — leading #hashtag", () => {
  it("extracts category from leading #tag", () => {
    const r = parseCapture("#recipes https://cooking.com/pasta");
    expect(r.category).toBe("recipes");
    expect(r.source).toBe("https://cooking.com/pasta");
    expect(r.kind).toBe("url");
  });

  it("lowercases hashtag category", () => {
    const r = parseCapture("#MyTag some note");
    expect(r.category).toBe("mytag");
    expect(r.source).toBe("some note");
  });

  it("leading hashtag with youtube link", () => {
    const r = parseCapture("#learning https://youtu.be/xyz");
    expect(r.category).toBe("learning");
    expect(r.kind).toBe("youtube");
  });
});

describe("parseCapture — trailing #hashtag", () => {
  it("extracts category from trailing #tag", () => {
    const r = parseCapture("https://example.com/article #reading");
    expect(r.category).toBe("reading");
    expect(r.source).toBe("https://example.com/article");
    expect(r.kind).toBe("url");
  });

  it("trailing hashtag on plain text", () => {
    const r = parseCapture("interesting idea about RAG #ai");
    expect(r.category).toBe("ai");
    expect(r.source).toBe("interesting idea about RAG");
    expect(r.kind).toBe("text");
  });

  it("lowercases trailing hashtag", () => {
    const r = parseCapture("note #MyCategory");
    expect(r.category).toBe("mycategory");
  });
});

describe("parseCapture — priority order", () => {
  it("'under' prefix wins over trailing hashtag", () => {
    // "under work" is the category; the trailing #ideas is part of source
    const r = parseCapture("under work some note #ideas");
    expect(r.category).toBe("work");
    // source includes the trailing hashtag since 'under' consumed it
    expect(r.source).toBe("some note #ideas");
  });

  it("leading hashtag wins over trailing hashtag", () => {
    const r = parseCapture("#first some text #second");
    expect(r.category).toBe("first");
    expect(r.source).toBe("some text #second");
  });
});

describe("parseCapture — raw text is preserved on source", () => {
  it("does not mutate the input string", () => {
    const raw = "under notes a note with spaces   ";
    const r = parseCapture(raw);
    expect(r.source).toBe("a note with spaces");
    // original raw is untouched (parseCapture is pure)
    expect(raw).toBe("under notes a note with spaces   ");
  });
});
