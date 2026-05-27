// scripts/__tests__/verify-no-secrets.test.mjs
import { describe, it, expect } from "vitest";
import { findSecrets, shouldSkipFile } from "../verify-no-secrets.mjs";

describe("findSecrets", () => {
  it("returns empty for clean text", () => {
    expect(findSecrets("clean prose nothing here")).toEqual([]);
  });

  it("flags a Telegram bot token shape", () => {
    const hits = findSecrets("token: 8390266374:AAEsomethingverylongstringforatokenXYZ");
    expect(hits.some((h) => h.kind === "telegram-bot-token")).toBe(true);
  });

  it("flags a 64-hex webhook secret in non-integrity context", () => {
    const hits = findSecrets("secret = " + "a".repeat(64));
    expect(hits.some((h) => h.kind === "webhook-secret-64hex")).toBe(true);
  });

  it("flags a Convex deployment URL", () => {
    const hits = findSecrets("convex url: exciting-fennec-671.convex.cloud");
    expect(hits.some((h) => h.kind === "convex-deployment")).toBe(true);
  });

  it("flags a -100 chat ID", () => {
    const hits = findSecrets("chat -1001234567890");
    expect(hits.some((h) => h.kind === "telegram-chat-id")).toBe(true);
  });
});

describe("shouldSkipFile — C4 lockfile false-positive guard", () => {
  it("skips package-lock.json, yarn.lock, pnpm-lock.yaml, _generated/, *.map", () => {
    expect(shouldSkipFile("package-lock.json")).toBe(true);
    expect(shouldSkipFile("yarn.lock")).toBe(true);
    expect(shouldSkipFile("pnpm-lock.yaml")).toBe(true);
    expect(shouldSkipFile("convex/_generated/api.d.ts")).toBe(true);
    expect(shouldSkipFile("dist/bundle.js.map")).toBe(true);
    expect(shouldSkipFile("README.md")).toBe(false); // NOT skipped — docs must use placeholders
    expect(shouldSkipFile("convex/lib/telegramHtml.ts")).toBe(false);
  });
});
