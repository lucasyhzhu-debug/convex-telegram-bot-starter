// convex/inbox/__tests__/documentCapture.test.ts
//
// convex-test integration tests for document (file upload) capture.
// Covers:
//   - document message → enqueues pending row with kind "document" + fileId + fileName
//   - caption category parsing ("under cv" → category cv)
//   - dedupe on repeat update_id (via webhook path)
//   - document WITHOUT caption defaults category "inbox"
//   - text-only messages still behave as before (regression)
//
// Pure-function webhook tests for the document branch live alongside
// existing webhookCapture.test.ts below.

import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal, api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { decideWebhookOutcome } from "../../telegram/webhook";
import { buildCommandMatcher, type CommandRegistration } from "../../telegram/commands";

const CHAT = "chat-doc-test";
const NOW = 1_700_000_000_000;

// ─── convex-test: document enqueue shape ─────────────────────────────────────

describe("enqueue document — listPending shape", () => {
  it("document item appears with kind='document', fileId, fileName, and mimeType", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.inbox.enqueue, {
      category: "cv",
      source: "resume.pdf",
      kind: "document",
      chatId: CHAT,
      op: "save",
      fileId: "BQACAgIAAxkBAAIBcmR",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      caption: "under cv my resume",
    });

    const rows = await t.query(api.inbox.listPending, { limit: 50 });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe("document");
    expect(row.fileId).toBe("BQACAgIAAxkBAAIBcmR");
    expect(row.fileName).toBe("resume.pdf");
    expect(row.mimeType).toBe("application/pdf");
    expect(row.category).toBe("cv");
    expect(row.op).toBe("save");
    expect(row.chatId).toBe(CHAT);
  });

  it("document WITHOUT caption → category defaults to 'inbox'", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.inbox.enqueue, {
      category: "inbox",
      source: "notes.pdf",
      kind: "document",
      chatId: CHAT,
      op: "save",
      fileId: "FILE_ID_XYZ",
      fileName: "notes.pdf",
    });

    const rows = await t.query(api.inbox.listPending, { limit: 50 });

    expect(rows[0]!.category).toBe("inbox");
    expect(rows[0]!.kind).toBe("document");
    expect(rows[0]!.fileId).toBe("FILE_ID_XYZ");
    expect(rows[0]!.fileName).toBe("notes.pdf");
    expect(rows[0]!.mimeType).toBeUndefined();
  });

  it("source is set to caption when provided, fileName otherwise", async () => {
    const t = convexTest(schema);

    // With caption
    await t.mutation(internal.inbox.enqueue, {
      category: "inbox",
      source: "my resume doc",
      kind: "document",
      chatId: CHAT,
      op: "save",
      fileId: "FILE1",
      fileName: "resume.pdf",
      caption: "my resume doc",
    });

    const rows = await t.query(api.inbox.listPending, { limit: 50 });
    expect(rows[0]!.source).toBe("my resume doc");
  });
});

// ─── convex-test: text-only regression ───────────────────────────────────────

describe("text-only enqueue — regression", () => {
  it("text message still enqueues with kind='url' and no fileId", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.inbox.enqueue, {
      category: "inbox",
      source: "https://example.com",
      kind: "url",
      chatId: CHAT,
      op: "save",
    });

    const rows = await t.query(api.inbox.listPending, { limit: 50 });

    expect(rows[0]!.kind).toBe("url");
    expect(rows[0]!.fileId).toBeUndefined();
    expect(rows[0]!.fileName).toBeUndefined();
    expect(rows[0]!.mimeType).toBeUndefined();
  });

  it("text enqueue with op='ask' returns op in listPending (regression)", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.inbox.enqueue, {
      category: "ask",
      source: "what is the capital of France?",
      kind: "text",
      chatId: CHAT,
      op: "ask",
    });

    const rows = await t.query(api.inbox.listPending, { limit: 50 });
    expect(rows[0]!.op).toBe("ask");
    expect(rows[0]!.kind).toBe("text");
  });
});

// ─── convex-test: dedupe via telegramUpdates ──────────────────────────────────

describe("document dedupe via recordIfNew", () => {
  it("second call with same update_id returns false (already recorded)", async () => {
    const t = convexTest(schema);

    const first = await t.mutation(internal.telegram.webhook.recordIfNew, { updateId: 9999 });
    const second = await t.mutation(internal.telegram.webhook.recordIfNew, { updateId: 9999 });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("different update_ids both return true", async () => {
    const t = convexTest(schema);

    const a = await t.mutation(internal.telegram.webhook.recordIfNew, { updateId: 1001 });
    const b = await t.mutation(internal.telegram.webhook.recordIfNew, { updateId: 1002 });

    expect(a).toBe(true);
    expect(b).toBe(true);
  });
});

// ─── Pure-function: decideWebhookOutcome document branch ─────────────────────

const SECRET = "test-secret";

function makeDocBody(updateId: number, doc: { file_id: string; file_name?: string; mime_type?: string }, caption?: string) {
  return {
    update_id: updateId,
    message: {
      document: doc,
      ...(caption !== undefined ? { caption } : {}),
      chat: { id: -1001234567890, type: "supergroup", title: "Doc Group" },
      from: { id: 77 },
    },
  };
}

function makeTextBody(updateId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      text,
      chat: { id: -1001234567890, type: "supergroup", title: "Doc Group" },
      from: { id: 77 },
    },
  };
}

function makeDeps(opts: {
  recordIfNewReturns?: boolean;
  capture?: ReturnType<typeof vi.fn>;
  onNonCommandMessage?: ReturnType<typeof vi.fn>;
} = {}) {
  const knownCmd: CommandRegistration = {
    name: "start",
    dispatch: vi.fn().mockResolvedValue(undefined),
  };
  return {
    recordIfNew: vi.fn().mockResolvedValue(opts.recordIfNewReturns ?? true),
    match: buildCommandMatcher([knownCmd]),
    capture: opts.capture,
    onNonCommandMessage: opts.onNonCommandMessage,
  };
}

describe("decideWebhookOutcome — document branch", () => {
  // D-1: document message triggers capture with DocumentInfo
  it("D-1: document message → recordIfNew called + capture called with DocumentInfo, 200", async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ capture });

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makeDocBody(100, { file_id: "FILE123", file_name: "cv.pdf", mime_type: "application/pdf" }, "my cv"),
      deps,
    });

    expect(result.status).toBe(200);
    expect(deps.recordIfNew).toHaveBeenCalledTimes(1);
    expect(deps.recordIfNew).toHaveBeenCalledWith(100);
    expect(capture).toHaveBeenCalledTimes(1);
    // Third arg should be the DocumentInfo
    const docArg = capture.mock.calls[0]![2];
    expect(docArg).toMatchObject({
      fileId: "FILE123",
      fileName: "cv.pdf",
      mimeType: "application/pdf",
      caption: "my cv",
    });
  });

  // D-2: document without caption — caption field undefined
  it("D-2: document WITHOUT caption → DocumentInfo has caption=undefined", async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ capture });

    await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makeDocBody(101, { file_id: "FILE456", file_name: "notes.docx" }),
      deps,
    });

    const docArg = capture.mock.calls[0]![2];
    expect(docArg.fileId).toBe("FILE456");
    expect(docArg.fileName).toBe("notes.docx");
    expect(docArg.caption).toBeUndefined();
  });

  // D-3: duplicate update_id → capture NOT called
  it("D-3: duplicate update_id for document → capture NOT called", async () => {
    const capture = vi.fn();
    const deps = makeDeps({ capture, recordIfNewReturns: false });

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makeDocBody(102, { file_id: "FILE789" }),
      deps,
    });

    expect(result.status).toBe(200);
    expect(deps.recordIfNew).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
  });

  // D-4: document capture throws → still 200 (C3 invariant)
  it("D-4: document capture throws after recordIfNew commits → still 200", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const capture = vi.fn().mockRejectedValue(new Error("capture failed"));
    const deps = makeDeps({ capture });

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makeDocBody(103, { file_id: "FILE_ERR" }),
      deps,
    });

    expect(result.status).toBe(200);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // D-5: document without capture dep → best-effort touch, no recordIfNew
  it("D-5: document WITHOUT capture dep → onNonCommandMessage called, recordIfNew NOT called", async () => {
    const touch = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ onNonCommandMessage: touch }); // no capture

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makeDocBody(104, { file_id: "FILE_NO_CAP" }),
      deps,
    });

    expect(result.status).toBe(200);
    expect(deps.recordIfNew).not.toHaveBeenCalled();
    expect(touch).toHaveBeenCalledTimes(1);
  });

  // D-6: 401 before any state — document message with bad secret
  it("D-6: 401 when secret missing — document capture never called", async () => {
    const capture = vi.fn();
    const deps = makeDeps({ capture });

    const result = await decideWebhookOutcome({
      providedSecret: null,
      expectedSecret: SECRET,
      body: makeDocBody(105, { file_id: "FILE_AUTH" }),
      deps,
    });

    expect(result.status).toBe(401);
    expect(capture).not.toHaveBeenCalled();
    expect(deps.recordIfNew).not.toHaveBeenCalled();
  });

  // D-7: text message still works as before (regression)
  it("D-7: text message with capture dep still works (regression)", async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ capture });

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makeTextBody(106, "https://example.com"),
      deps,
    });

    expect(result.status).toBe(200);
    expect(capture).toHaveBeenCalledTimes(1);
    // Text path: third arg (document) is undefined
    const docArg = capture.mock.calls[0]![2];
    expect(docArg).toBeUndefined();
  });

  // D-8: unknown slash command → document-unrelated, but verifying no cross-contamination
  it("D-8: unknown slash command is NOT treated as document", async () => {
    const capture = vi.fn();
    const deps = makeDeps({ capture });

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makeTextBody(107, "/unknowncmd"),
      deps,
    });

    expect(result.status).toBe(200);
    expect(capture).not.toHaveBeenCalled();
    expect(deps.recordIfNew).not.toHaveBeenCalled();
  });
});

// ─── Caption category parsing ─────────────────────────────────────────────────

import { parseCapture } from "../capture";

describe("caption category parsing for document messages", () => {
  it("'under cv' caption → category 'cv'", () => {
    const r = parseCapture("under cv my resume");
    expect(r.category).toBe("cv");
    expect(r.source).toBe("my resume");
  });

  it("#cv caption → category 'cv'", () => {
    const r = parseCapture("#cv my resume");
    expect(r.category).toBe("cv");
  });

  it("trailing #receipts → category 'receipts'", () => {
    const r = parseCapture("march invoice #receipts");
    expect(r.category).toBe("receipts");
    expect(r.source).toBe("march invoice");
  });

  it("empty caption → default 'inbox'", () => {
    // When no caption, code uses base=null → category "inbox"
    const r = parseCapture("");
    expect(r.category).toBe("inbox");
  });

  it("plain caption with no directive → default 'inbox'", () => {
    const r = parseCapture("my resume document");
    expect(r.category).toBe("inbox");
  });
});
