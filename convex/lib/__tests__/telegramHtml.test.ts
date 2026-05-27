import { describe, it, expect } from "vitest";
import { escapeHtml } from "../telegramHtml";

describe("escapeHtml", () => {
  it("escapes & < > only — quotes and apostrophes are untouched", () => {
    expect(escapeHtml(`Tom & Jerry <b>boss</b> "ok" 'fine'`))
      .toBe(`Tom &amp; Jerry &lt;b&gt;boss&lt;/b&gt; "ok" 'fine'`);
  });
  it("returns the input unchanged when no escapable chars", () => {
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
  });
  it("escapes & before < and > so we don't double-encode entities", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});
