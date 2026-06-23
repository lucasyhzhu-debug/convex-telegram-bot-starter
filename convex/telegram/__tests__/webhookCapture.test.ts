// convex/telegram/__tests__/webhookCapture.test.ts
//
// Tests for the capture dep extension added in the knowledge-inbox integration.
// Focuses on the new paths in decideWebhookOutcome:
//   - regular text with capture wired → dedupe + capture called
//   - regular text with capture wired, duplicate → no capture
//   - unknown slash command → no capture (unchanged)
//   - capture throw → still 200 (C3 invariant)
//   - capture NOT wired → no recordIfNew called for text (back-compat)
//
// Mirrors the style of webhook.test.ts — pure-function, no Convex runtime.

import { describe, it, expect, vi } from "vitest";
import { decideWebhookOutcome } from "../webhook";
import { buildCommandMatcher, type CommandRegistration } from "../commands";

const SECRET = "test-secret";

function body(updateId: number, text?: string) {
  return {
    update_id: updateId,
    message: {
      ...(text !== undefined ? { text } : {}),
      chat: { id: -1001234567890, type: "supergroup", title: "Brain Group" },
      from: { id: 99 },
    },
  };
}

function makeDeps(opts: {
  recordIfNewReturns?: boolean;
  capture?: ReturnType<typeof vi.fn>;
  onNonCommandMessage?: ReturnType<typeof vi.fn>;
} = {}) {
  const knownCmd: CommandRegistration = {
    name: "register",
    dispatch: vi.fn().mockResolvedValue(undefined),
  };
  return {
    recordIfNew: vi.fn().mockResolvedValue(opts.recordIfNewReturns ?? true),
    match: buildCommandMatcher([knownCmd]),
    capture: opts.capture,
    onNonCommandMessage: opts.onNonCommandMessage,
  };
}

describe("decideWebhookOutcome — capture dep (knowledge-inbox extension)", () => {
  // ── 200/401 invariants are unchanged ───────────────────────────────────────

  it("test C-1: 401 when secret missing — capture is never called", async () => {
    const capture = vi.fn();
    const deps = makeDeps({ capture });
    const result = await decideWebhookOutcome({
      providedSecret: null,
      expectedSecret: SECRET,
      body: body(1, "a note"),
      deps,
    });
    expect(result.status).toBe(401);
    expect(capture).not.toHaveBeenCalled();
    expect(deps.recordIfNew).not.toHaveBeenCalled();
  });

  it("test C-2: 401 when secret mismatch — capture is never called", async () => {
    const capture = vi.fn();
    const deps = makeDeps({ capture });
    const result = await decideWebhookOutcome({
      providedSecret: "wrong",
      expectedSecret: SECRET,
      body: body(2, "a note"),
      deps,
    });
    expect(result.status).toBe(401);
    expect(capture).not.toHaveBeenCalled();
  });

  // ── Regular text + capture wired ───────────────────────────────────────────

  it("test C-3: regular text with capture wired → recordIfNew called + capture called, 200", async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ capture });
    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: body(10, "https://example.com"),
      deps,
    });
    expect(result.status).toBe(200);
    expect(deps.recordIfNew).toHaveBeenCalledTimes(1);
    expect(deps.recordIfNew).toHaveBeenCalledWith(10);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("test C-4: capture receives correct MessageContext", async () => {
    const seen: unknown[] = [];
    const capture = vi.fn().mockImplementation(async (msg: unknown) => { seen.push(msg); });
    const deps = makeDeps({ capture });
    await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: body(11, "https://example.com"),
      deps,
    });
    expect(seen[0]).toMatchObject({
      chatId: "-1001234567890",
      chatType: "supergroup",
      title: "Brain Group",
      fromId: 99,
      text: "https://example.com",
    });
  });

  it("test C-5: duplicate update (recordIfNew=false) → capture NOT called", async () => {
    const capture = vi.fn();
    const deps = makeDeps({ capture, recordIfNewReturns: false });
    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: body(12, "some note"),
      deps,
    });
    expect(result.status).toBe(200);
    expect(deps.recordIfNew).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
  });

  // ── capture throw — C3 invariant ───────────────────────────────────────────

  it("test C-6 (C3): capture throws after recordIfNew commits → still 200, warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const capture = vi.fn().mockRejectedValue(new Error("capture failed"));
    const deps = makeDeps({ capture });
    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: body(13, "some text"),
      deps,
    });
    expect(result.status).toBe(200);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // ── Unknown slash command → capture NOT called ─────────────────────────────

  it("test C-7: unknown slash command → capture NOT called, recordIfNew NOT called", async () => {
    const capture = vi.fn();
    const deps = makeDeps({ capture });
    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: body(14, "/unknowncommand"),
      deps,
    });
    expect(result.status).toBe(200);
    expect(capture).not.toHaveBeenCalled();
    expect(deps.recordIfNew).not.toHaveBeenCalled();
  });

  // ── Known command → capture NOT called (commands use their own dispatch) ───

  it("test C-8: known command (/register) → capture NOT called", async () => {
    const capture = vi.fn();
    const deps = makeDeps({ capture });
    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: body(15, "/register"),
      deps,
    });
    expect(result.status).toBe(200);
    expect(capture).not.toHaveBeenCalled();
    // recordIfNew IS called for the command dedupe
    expect(deps.recordIfNew).toHaveBeenCalledTimes(1);
  });

  // ── capture NOT wired → back-compat: recordIfNew not called for text ───────

  it("test C-9: capture not wired → recordIfNew NOT called for regular text (back-compat)", async () => {
    const deps = makeDeps(); // no capture
    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: body(16, "hello there"),
      deps,
    });
    expect(result.status).toBe(200);
    expect(deps.recordIfNew).not.toHaveBeenCalled();
  });

  // ── onNonCommandMessage still fires alongside capture ─────────────────────

  it("test C-10: both onNonCommandMessage AND capture fire for regular text", async () => {
    const touch = vi.fn().mockResolvedValue(undefined);
    const capture = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ capture, onNonCommandMessage: touch });
    await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: body(17, "a link https://x.com"),
      deps,
    });
    expect(touch).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  // ── Non-text update (sticker) → no capture, no recordIfNew ────────────────

  it("test C-11: non-text update (no .text) → capture NOT called, recordIfNew NOT called", async () => {
    const capture = vi.fn();
    const deps = makeDeps({ capture });
    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      // no text field → sticker/photo/etc
      body: body(18),
      deps,
    });
    expect(result.status).toBe(200);
    expect(capture).not.toHaveBeenCalled();
    expect(deps.recordIfNew).not.toHaveBeenCalled();
  });

  // ── recordIfNew ordering: dedupe committed before capture ─────────────────

  it("test C-12: recordIfNew commits before capture runs (ordering guarantee)", async () => {
    const order: string[] = [];
    const recordIfNew = vi.fn().mockImplementation(async () => {
      order.push("record");
      return true;
    });
    const capture = vi.fn().mockImplementation(async () => {
      order.push("capture");
    });
    const knownCmd: CommandRegistration = {
      name: "register",
      dispatch: vi.fn().mockResolvedValue(undefined),
    };
    const deps = {
      recordIfNew,
      match: buildCommandMatcher([knownCmd]),
      capture,
    };
    await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: body(19, "some text"),
      deps,
    });
    expect(order).toEqual(["record", "capture"]);
  });
});

// ─── /post-message auth logic (tested via pure helper) ───────────────────────
//
// The httpAction itself uses fetch and ctx.runQuery, which require Convex runtime.
// We test the auth decision — constant-time compare + 401 invariant — separately
// via the constantTimeEqual helper that it delegates to.

import { constantTimeEqual } from "../../lib/constantTimeEqual";

describe("post-message auth (constantTimeEqual invariant)", () => {
  it("test PM-1: matching secrets → equal", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
  });

  it("test PM-2: mismatched secrets → not equal", () => {
    expect(constantTimeEqual("abc123", "wrong!")).toBe(false);
  });

  it("test PM-3: empty vs non-empty → not equal (length guard)", () => {
    expect(constantTimeEqual("", "abc")).toBe(false);
  });

  it("test PM-4: empty vs empty → equal", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });
});
