// convex/inbox/__tests__/intent.test.ts
//
// Pure-function tests for classifyIntent.
// No Convex runtime, no fetch mocks — just logic.

import { describe, it, expect } from "vitest";
import { classifyIntent } from "../capture";

// ─── save: prefix ────────────────────────────────────────────────────────────

describe("classifyIntent — save: prefix", () => {
  it("'save: some text' → intent save, op save", () => {
    const r = classifyIntent("save: some text");
    expect(r.intent).toBe("save");
    expect(r.op).toBe("save");
  });

  it("'save:no space' → intent save, op save", () => {
    const r = classifyIntent("save:no space");
    expect(r.intent).toBe("save");
    expect(r.op).toBe("save");
  });

  it("case-insensitive SAVE: prefix", () => {
    const r = classifyIntent("SAVE: something here");
    expect(r.intent).toBe("save");
    expect(r.op).toBe("save");
  });
});

// ─── ask: prefix ─────────────────────────────────────────────────────────────

describe("classifyIntent — ask: prefix", () => {
  it("'ask: what is X' → intent ask, op ask", () => {
    const r = classifyIntent("ask: what is X");
    expect(r.intent).toBe("ask");
    expect(r.op).toBe("ask");
  });

  it("'ask:no space' → intent ask, op ask", () => {
    const r = classifyIntent("ask:no space");
    expect(r.intent).toBe("ask");
    expect(r.op).toBe("ask");
  });

  it("case-insensitive ASK: prefix", () => {
    const r = classifyIntent("ASK: something");
    expect(r.intent).toBe("ask");
    expect(r.op).toBe("ask");
  });
});

// ─── URL → save ──────────────────────────────────────────────────────────────

describe("classifyIntent — URL → save", () => {
  it("https URL → intent save, op save", () => {
    const r = classifyIntent("https://example.com/article");
    expect(r.intent).toBe("save");
    expect(r.op).toBe("save");
  });

  it("http URL → intent save, op save", () => {
    const r = classifyIntent("http://example.com");
    expect(r.intent).toBe("save");
    expect(r.op).toBe("save");
  });
});

// ─── directive → save ────────────────────────────────────────────────────────

describe("classifyIntent — directive → save", () => {
  it("'under recipes ...' → intent save, op save", () => {
    const r = classifyIntent("under recipes some text");
    expect(r.intent).toBe("save");
    expect(r.op).toBe("save");
  });

  it("leading hashtag → intent save, op save", () => {
    const r = classifyIntent("#ai some note about AI");
    expect(r.intent).toBe("save");
    expect(r.op).toBe("save");
  });

  it("trailing hashtag → intent save, op save", () => {
    const r = classifyIntent("some note about AI #ai");
    expect(r.intent).toBe("save");
    expect(r.op).toBe("save");
  });
});

// ─── plain prose → ask ───────────────────────────────────────────────────────

describe("classifyIntent — plain prose → ask", () => {
  it("plain sentence → intent ask, op ask", () => {
    const r = classifyIntent("I need to remember to read more about RAG");
    expect(r.intent).toBe("ask");
    expect(r.op).toBe("ask");
  });

  it("question with '?' → intent ask, op ask", () => {
    const r = classifyIntent("What is the best way to learn Convex?");
    expect(r.intent).toBe("ask");
    expect(r.op).toBe("ask");
  });

  it("short word → intent ask, op ask", () => {
    const r = classifyIntent("hello");
    expect(r.intent).toBe("ask");
    expect(r.op).toBe("ask");
  });
});

// ─── ask sets category='ask', kind='text' ────────────────────────────────────

describe("classifyIntent — ask sets category='ask', kind='text'", () => {
  it("ask result has category 'ask' and kind 'text'", () => {
    const r = classifyIntent("what is the capital of France?");
    expect(r.category).toBe("ask");
    expect(r.kind).toBe("text");
  });

  it("ask: prefix also gives category 'ask' and kind 'text'", () => {
    const r = classifyIntent("ask: what should I read next?");
    expect(r.category).toBe("ask");
    expect(r.kind).toBe("text");
  });
});

// ─── prefix stripping ────────────────────────────────────────────────────────

describe("classifyIntent — prefix stripping", () => {
  it("save: prefix is stripped from source", () => {
    const r = classifyIntent("save: https://example.com");
    expect(r.source).toBe("https://example.com");
    expect(r.source).not.toMatch(/^save:/i);
  });

  it("ask: prefix is stripped from source", () => {
    const r = classifyIntent("ask: what is Convex?");
    expect(r.source).toBe("what is Convex?");
    expect(r.source).not.toMatch(/^ask:/i);
  });

  it("save: prefix with category directive parses category correctly", () => {
    const r = classifyIntent("save: under recipes https://cooking.com");
    expect(r.op).toBe("save");
    expect(r.category).toBe("recipes");
    expect(r.source).toBe("https://cooking.com");
  });
});
