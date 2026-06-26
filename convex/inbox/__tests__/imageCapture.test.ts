// convex/inbox/__tests__/imageCapture.test.ts
//
// convex-test integration tests for native photo (message.photo) capture.
// Mirrors documentCapture.test.ts exactly — same suite structure, same invariants.
//
// Covers:
//   - photo message → enqueues pending row with kind="image" + largest file_id + synthesized fileName
//   - caption category parsing ("under cv" → category "cv")
//   - dedupe on repeat update_id (via recordIfNew)
//   - photo WITHOUT caption → category defaults to "inbox"
//   - text + document messages still behave exactly as before (regression)
//
// Pure-function webhook tests for the photo branch follow the convex-test section.

import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal, api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { decideWebhookOutcome } from "../../telegram/webhook";
import { buildCommandMatcher, type CommandRegistration } from "../../telegram/commands";

const CHAT = "chat-photo-test";

// ─── convex-test: image enqueue shape ────────────────────────────────────────

describe("enqueue image — listPending shape", () => {
  it("image item appears with kind='image', fileId, fileName, and mimeType", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.inbox.enqueue, {
      category: "photos",
      source: "vacation shot",
      kind: "image",
      chatId: CHAT,
      op: "save",
      fileId: "AgACAgIAAxkBAAIB_photo123",
      fileName: "telegram-photo-7001.jpg",
      mimeType: "image/jpeg",
      caption: "vacation shot",
    });

    const rows = await t.query(api.inbox.listPending, { limit: 50 });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe("image");
    expect(row.fileId).toBe("AgACAgIAAxkBAAIB_photo123");
    expect(row.fileName).toBe("telegram-photo-7001.jpg");
    expect(row.mimeType).toBe("image/jpeg");
    expect(row.category).toBe("photos");
    expect(row.op).toBe("save");
    expect(row.chatId).toBe(CHAT);
  });

  it("image WITHOUT caption → category defaults to 'inbox'", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.inbox.enqueue, {
      category: "inbox",
      source: "[image]",
      kind: "image",
      chatId: CHAT,
      op: "save",
      fileId: "PHOTO_ID_XYZ",
      fileName: "telegram-photo-7002.jpg",
      mimeType: "image/jpeg",
    });

    const rows = await t.query(api.inbox.listPending, { limit: 50 });

    expect(rows[0]!.category).toBe("inbox");
    expect(rows[0]!.kind).toBe("image");
    expect(rows[0]!.fileId).toBe("PHOTO_ID_XYZ");
    expect(rows[0]!.fileName).toBe("telegram-photo-7002.jpg");
    expect(rows[0]!.mimeType).toBe("image/jpeg");
  });

  it("source is set to caption text when provided, '[image]' otherwise", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.inbox.enqueue, {
      category: "inbox",
      source: "my screenshot",
      kind: "image",
      chatId: CHAT,
      op: "save",
      fileId: "PHOTO1",
      fileName: "telegram-photo-7003.jpg",
      mimeType: "image/jpeg",
      caption: "my screenshot",
    });

    const rows = await t.query(api.inbox.listPending, { limit: 50 });
    expect(rows[0]!.source).toBe("my screenshot");
  });
});

// ─── convex-test: text-only + document regression ────────────────────────────

describe("text and document enqueue — regression after image support", () => {
  it("text URL message still enqueues with kind='url' and no fileId", async () => {
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
    expect(rows[0]!.mimeType).toBeUndefined();
  });

  it("document message still enqueues with kind='document'", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.inbox.enqueue, {
      category: "cv",
      source: "resume.pdf",
      kind: "document",
      chatId: CHAT,
      op: "save",
      fileId: "DOC_FILE_ID",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
    });

    const rows = await t.query(api.inbox.listPending, { limit: 50 });
    expect(rows[0]!.kind).toBe("document");
    expect(rows[0]!.fileId).toBe("DOC_FILE_ID");
  });
});

// ─── convex-test: dedupe via telegramUpdates ──────────────────────────────────

describe("image dedupe via recordIfNew", () => {
  it("second call with same update_id returns false (already recorded)", async () => {
    const t = convexTest(schema);

    const first = await t.mutation(internal.telegram.webhook.recordIfNew, { updateId: 8001 });
    const second = await t.mutation(internal.telegram.webhook.recordIfNew, { updateId: 8001 });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("different update_ids both return true", async () => {
    const t = convexTest(schema);

    const a = await t.mutation(internal.telegram.webhook.recordIfNew, { updateId: 8010 });
    const b = await t.mutation(internal.telegram.webhook.recordIfNew, { updateId: 8011 });

    expect(a).toBe(true);
    expect(b).toBe(true);
  });
});

// ─── Pure-function: decideWebhookOutcome photo branch ────────────────────────

const SECRET = "test-secret";

/** Build a native photo message body. photos is smallest→largest (Telegram order). */
function makePhotoBody(
  updateId: number,
  photos: Array<{ file_id: string; width?: number; height?: number }>,
  caption?: string,
) {
  return {
    update_id: updateId,
    message: {
      photo: photos,
      ...(caption !== undefined ? { caption } : {}),
      chat: { id: -1001234567890, type: "supergroup", title: "Photo Group" },
      from: { id: 77 },
    },
  };
}

function makeTextBody(updateId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      text,
      chat: { id: -1001234567890, type: "supergroup", title: "Photo Group" },
      from: { id: 77 },
    },
  };
}

function makeDocBody(
  updateId: number,
  doc: { file_id: string; file_name?: string; mime_type?: string },
  caption?: string,
) {
  return {
    update_id: updateId,
    message: {
      document: doc,
      ...(caption !== undefined ? { caption } : {}),
      chat: { id: -1001234567890, type: "supergroup", title: "Photo Group" },
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

describe("decideWebhookOutcome — photo branch", () => {
  // P-1: photo message triggers capture with DocumentInfo (isImage=true)
  it("P-1: photo message → recordIfNew called + capture called with DocumentInfo isImage=true, 200", async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ capture });

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makePhotoBody(
        200,
        [
          { file_id: "SMALL_ID", width: 90, height: 90 },
          { file_id: "LARGE_ID", width: 1280, height: 960 },
        ],
        "my photo caption",
      ),
      deps,
    });

    expect(result.status).toBe(200);
    expect(deps.recordIfNew).toHaveBeenCalledTimes(1);
    expect(deps.recordIfNew).toHaveBeenCalledWith(200);
    expect(capture).toHaveBeenCalledTimes(1);
    const docArg = capture.mock.calls[0]![2];
    expect(docArg).toMatchObject({
      fileId: "LARGE_ID",
      fileName: "telegram-photo-200.jpg",
      mimeType: "image/jpeg",
      caption: "my photo caption",
      isImage: true,
    });
  });

  // P-2: uses LAST element (largest) from the photo array
  it("P-2: always uses the LAST (largest) photo element's file_id", async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ capture });

    await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makePhotoBody(201, [
        { file_id: "THUMB_ID" },
        { file_id: "MEDIUM_ID" },
        { file_id: "FULL_ID" },
      ]),
      deps,
    });

    const docArg = capture.mock.calls[0]![2];
    expect(docArg.fileId).toBe("FULL_ID");
  });

  // P-3: synthesized fileName uses update_id
  it("P-3: synthesized fileName is telegram-photo-<update_id>.jpg", async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ capture });

    await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makePhotoBody(202, [{ file_id: "ID_202" }]),
      deps,
    });

    const docArg = capture.mock.calls[0]![2];
    expect(docArg.fileName).toBe("telegram-photo-202.jpg");
    expect(docArg.mimeType).toBe("image/jpeg");
  });

  // P-4: photo without caption → caption undefined in DocumentInfo
  it("P-4: photo WITHOUT caption → DocumentInfo has caption=undefined", async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ capture });

    await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makePhotoBody(203, [{ file_id: "NO_CAP_ID" }]),
      deps,
    });

    const docArg = capture.mock.calls[0]![2];
    expect(docArg.caption).toBeUndefined();
  });

  // P-5: duplicate update_id → capture NOT called
  it("P-5: duplicate update_id for photo → capture NOT called", async () => {
    const capture = vi.fn();
    const deps = makeDeps({ capture, recordIfNewReturns: false });

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makePhotoBody(204, [{ file_id: "DUP_ID" }]),
      deps,
    });

    expect(result.status).toBe(200);
    expect(deps.recordIfNew).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
  });

  // P-6: capture throws → still 200 (C3 invariant)
  it("P-6: photo capture throws after recordIfNew commits → still 200", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const capture = vi.fn().mockRejectedValue(new Error("photo capture failed"));
    const deps = makeDeps({ capture });

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makePhotoBody(205, [{ file_id: "ERR_ID" }]),
      deps,
    });

    expect(result.status).toBe(200);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // P-7: photo without capture dep → best-effort touch, no recordIfNew
  it("P-7: photo WITHOUT capture dep → onNonCommandMessage called, recordIfNew NOT called", async () => {
    const touch = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ onNonCommandMessage: touch }); // no capture

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makePhotoBody(206, [{ file_id: "NO_CAP_DEP_ID" }]),
      deps,
    });

    expect(result.status).toBe(200);
    expect(deps.recordIfNew).not.toHaveBeenCalled();
    expect(touch).toHaveBeenCalledTimes(1);
  });

  // P-8: 401 before any state — photo message with bad secret
  it("P-8: 401 when secret missing — photo capture never called", async () => {
    const capture = vi.fn();
    const deps = makeDeps({ capture });

    const result = await decideWebhookOutcome({
      providedSecret: null,
      expectedSecret: SECRET,
      body: makePhotoBody(207, [{ file_id: "AUTH_ID" }]),
      deps,
    });

    expect(result.status).toBe(401);
    expect(capture).not.toHaveBeenCalled();
    expect(deps.recordIfNew).not.toHaveBeenCalled();
  });

  // P-9: text message still works (regression)
  it("P-9: text message with capture dep still works (regression)", async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ capture });

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makeTextBody(208, "https://example.com"),
      deps,
    });

    expect(result.status).toBe(200);
    expect(capture).toHaveBeenCalledTimes(1);
    // Text path: third arg (document) is undefined
    expect(capture.mock.calls[0]![2]).toBeUndefined();
  });

  // P-10: document message still works — photo branch does not intercept it (regression)
  it("P-10: document message goes through document branch, NOT photo branch (regression)", async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ capture });

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makeDocBody(209, { file_id: "DOC_FILE", file_name: "report.pdf", mime_type: "application/pdf" }, "my report"),
      deps,
    });

    expect(result.status).toBe(200);
    expect(capture).toHaveBeenCalledTimes(1);
    const docArg = capture.mock.calls[0]![2];
    // isImage must be absent/falsy for a document message
    expect(docArg.isImage).toBeFalsy();
    expect(docArg.fileId).toBe("DOC_FILE");
    expect(docArg.mimeType).toBe("application/pdf");
  });

  // P-11: unknown slash command → photo-unrelated, no cross-contamination
  it("P-11: unknown slash command is NOT treated as photo", async () => {
    const capture = vi.fn();
    const deps = makeDeps({ capture });

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: makeTextBody(210, "/unknowncmd"),
      deps,
    });

    expect(result.status).toBe(200);
    expect(capture).not.toHaveBeenCalled();
    expect(deps.recordIfNew).not.toHaveBeenCalled();
  });
});

// ─── Caption category parsing for photo messages ──────────────────────────────

import { parseCapture } from "../capture";

describe("caption category parsing for photo messages", () => {
  it("'under receipts' caption → category 'receipts'", () => {
    const r = parseCapture("under receipts march dinner");
    expect(r.category).toBe("receipts");
    expect(r.source).toBe("march dinner");
  });

  it("#screenshots caption → category 'screenshots'", () => {
    const r = parseCapture("#screenshots my design");
    expect(r.category).toBe("screenshots");
  });

  it("trailing #photos → category 'photos'", () => {
    const r = parseCapture("beach sunset #photos");
    expect(r.category).toBe("photos");
    expect(r.source).toBe("beach sunset");
  });

  it("empty caption → default 'inbox'", () => {
    const r = parseCapture("");
    expect(r.category).toBe("inbox");
  });

  it("plain caption with no directive → default 'inbox'", () => {
    const r = parseCapture("just a quick snap");
    expect(r.category).toBe("inbox");
  });
});
