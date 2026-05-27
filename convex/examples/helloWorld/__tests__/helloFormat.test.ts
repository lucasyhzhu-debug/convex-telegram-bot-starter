// convex/examples/helloWorld/__tests__/helloFormat.test.ts
import { describe, it, expect } from "vitest";
import { formatHello } from "../helloFormat";

describe("formatHello", () => {
  it("returns a single chunk", () => {
    const out = formatHello({ reason: "cron", generatedAt: Date.parse("2026-05-27T12:00:00Z") });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Hello");
  });

  it("uses the cron reason in the header", () => {
    const out = formatHello({ reason: "cron", generatedAt: Date.parse("2026-05-27T12:00:00Z") });
    expect(out[0]).toContain("Daily");
  });

  it("uses the command reason in the header", () => {
    const out = formatHello({ reason: "command", generatedAt: Date.parse("2026-05-27T12:00:00Z") });
    expect(out[0]).toContain("On-demand");
  });
});
