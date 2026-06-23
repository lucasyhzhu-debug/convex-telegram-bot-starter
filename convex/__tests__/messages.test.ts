// convex/__tests__/messages.test.ts
//
// convex-test integration tests for the messages and threads tables.
// Covers: logMessage, listSince, listPending (op field), getSessionContext,
// resolveThread session windowing.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal, api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { THREAD_IDLE_MS } from "../messages";

const NOW = 1_700_000_000_000;
const CHAT = "chat-123";
const CHAT2 = "chat-456";

// ── logMessage + listSince ────────────────────────────────────────────────────

describe("logMessage stores rows; listSince returns them", () => {
  it("stores direction 'in' and 'out' rows and listSince returns both", async () => {
    const t = convexTest(schema);

    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        chatId: CHAT,
        direction: "in",
        text: "hello",
        createdAt: NOW,
      });
      await ctx.db.insert("messages", {
        chatId: CHAT,
        direction: "out",
        text: "world",
        createdAt: NOW + 1000,
      });
    });

    const rows = await t.query(api.messages.listSince, {
      sinceMs: NOW,
      limit: 50,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].direction).toBe("in");
    expect(rows[0].text).toBe("hello");
    expect(rows[1].direction).toBe("out");
    expect(rows[1].text).toBe("world");
  });

  it("listSince respects the sinceMs lower bound", async () => {
    const t = convexTest(schema);

    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        chatId: CHAT,
        direction: "in",
        text: "old message",
        createdAt: NOW - 10000,
      });
      await ctx.db.insert("messages", {
        chatId: CHAT,
        direction: "in",
        text: "new message",
        createdAt: NOW + 1,
      });
    });

    const rows = await t.query(api.messages.listSince, {
      sinceMs: NOW,
      limit: 50,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("new message");
  });

  it("listSince returns op field when present", async () => {
    const t = convexTest(schema);

    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        chatId: CHAT,
        direction: "in",
        text: "ask something",
        intent: "ask",
        op: "ask",
        createdAt: NOW,
      });
    });

    const rows = await t.query(api.messages.listSince, {
      sinceMs: NOW,
      limit: 50,
    });

    expect(rows[0].op).toBe("ask");
    expect(rows[0].intent).toBe("ask");
  });
});

// ── logMessage via internalMutation ──────────────────────────────────────────

describe("logMessage internalMutation", () => {
  it("logMessage stores an inbound row readable by listSince", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.messages.logMessage, {
      chatId: CHAT,
      direction: "in",
      text: "a test message",
      intent: "save",
      op: "save",
      createdAt: NOW,
    });

    const rows = await t.query(api.messages.listSince, {
      sinceMs: NOW,
      limit: 50,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("a test message");
    expect(rows[0].direction).toBe("in");
    expect(rows[0].intent).toBe("save");
    expect(rows[0].op).toBe("save");
  });
});

// ── enqueue op field + listPending ───────────────────────────────────────────

describe("listPending op field", () => {
  it("enqueue with op='save' returns op in listPending", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.inbox.enqueue, {
      category: "inbox",
      source: "https://example.com",
      kind: "url",
      chatId: CHAT,
      op: "save",
    });

    const rows = await t.query(api.inbox.listPending, { limit: 50 });

    expect(rows).toHaveLength(1);
    expect(rows[0].op).toBe("save");
    expect(rows[0].kind).toBe("url");
    expect(rows[0].chatId).toBe(CHAT);
  });

  it("enqueue with op='ask' returns op in listPending", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.inbox.enqueue, {
      category: "ask",
      source: "what is Convex?",
      kind: "text",
      chatId: CHAT,
      op: "ask",
    });

    const rows = await t.query(api.inbox.listPending, { limit: 50 });

    expect(rows[0].op).toBe("ask");
  });

  it("enqueue without op returns undefined op in listPending", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.inbox.enqueue, {
      category: "inbox",
      source: "some text",
      kind: "text",
      chatId: CHAT,
    });

    const rows = await t.query(api.inbox.listPending, { limit: 50 });

    expect(rows[0].op).toBeUndefined();
  });
});

// ── getSessionContext ─────────────────────────────────────────────────────────

describe("getSessionContext", () => {
  it("returns [] when no thread exists", async () => {
    const t = convexTest(schema);

    const result = await t.query(api.messages.getSessionContext, {
      chatId: CHAT,
      limit: 20,
    });

    expect(result).toEqual([]);
  });

  it("returns [] when most recent thread is idle", async () => {
    const t = convexTest(schema);

    await t.run(async (ctx) => {
      const threadId = await ctx.db.insert("threads", {
        chatId: CHAT,
        startedAt: NOW,
        lastActiveAt: NOW,
        status: "idle",
      });
      await ctx.db.insert("messages", {
        chatId: CHAT,
        direction: "in",
        text: "old message",
        threadId,
        createdAt: NOW,
      });
    });

    const result = await t.query(api.messages.getSessionContext, {
      chatId: CHAT,
      limit: 20,
    });

    expect(result).toEqual([]);
  });

  it("returns messages for active thread, oldest-first", async () => {
    const t = convexTest(schema);

    await t.run(async (ctx) => {
      const threadId = await ctx.db.insert("threads", {
        chatId: CHAT,
        startedAt: NOW,
        lastActiveAt: NOW + 2000,
        status: "active",
      });
      await ctx.db.insert("messages", {
        chatId: CHAT,
        direction: "in",
        text: "first",
        threadId,
        createdAt: NOW,
      });
      await ctx.db.insert("messages", {
        chatId: CHAT,
        direction: "out",
        text: "second",
        threadId,
        createdAt: NOW + 1000,
      });
      await ctx.db.insert("messages", {
        chatId: CHAT,
        direction: "in",
        text: "third",
        threadId,
        createdAt: NOW + 2000,
      });
    });

    const result = await t.query(api.messages.getSessionContext, {
      chatId: CHAT,
      limit: 20,
    });

    expect(result).toHaveLength(3);
    expect(result[0].text).toBe("first");
    expect(result[1].text).toBe("second");
    expect(result[2].text).toBe("third");
  });

  it("respects the limit parameter (returns last N messages)", async () => {
    const t = convexTest(schema);

    await t.run(async (ctx) => {
      const threadId = await ctx.db.insert("threads", {
        chatId: CHAT,
        startedAt: NOW,
        lastActiveAt: NOW + 4000,
        status: "active",
      });
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("messages", {
          chatId: CHAT,
          direction: "in",
          text: `msg ${i}`,
          threadId,
          createdAt: NOW + i * 1000,
        });
      }
    });

    const result = await t.query(api.messages.getSessionContext, {
      chatId: CHAT,
      limit: 3,
    });

    expect(result).toHaveLength(3);
    expect(result[0].text).toBe("msg 2");
    expect(result[2].text).toBe("msg 4");
  });

  it("only returns messages for the active thread (not other threads)", async () => {
    const t = convexTest(schema);

    await t.run(async (ctx) => {
      const oldThread = await ctx.db.insert("threads", {
        chatId: CHAT,
        startedAt: NOW - 10000,
        lastActiveAt: NOW - 5000,
        status: "idle",
      });
      await ctx.db.insert("messages", {
        chatId: CHAT,
        direction: "in",
        text: "old thread message",
        threadId: oldThread,
        createdAt: NOW - 5000,
      });

      const newThread = await ctx.db.insert("threads", {
        chatId: CHAT,
        startedAt: NOW,
        lastActiveAt: NOW + 1000,
        status: "active",
      });
      await ctx.db.insert("messages", {
        chatId: CHAT,
        direction: "in",
        text: "new thread message",
        threadId: newThread,
        createdAt: NOW + 1000,
      });
    });

    const result = await t.query(api.messages.getSessionContext, {
      chatId: CHAT,
      limit: 20,
    });

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("new thread message");
  });
});

// ── resetActiveThread ─────────────────────────────────────────────────────────

describe("resetActiveThread", () => {
  it("sets an active thread to idle", async () => {
    const t = convexTest(schema);

    // Create an active thread
    const threadId = await t.mutation(internal.messages.resolveThread, {
      chatId: CHAT,
      now: NOW,
    });

    // Reset it
    await t.mutation(internal.messages.resetActiveThread, { chatId: CHAT });

    const thread = await t.run(async (ctx) => ctx.db.get(threadId as Id<"threads">));
    expect(thread!.status).toBe("idle");
  });

  it("is idempotent — no-op when no active thread exists", async () => {
    const t = convexTest(schema);

    // No threads at all — should not throw
    await expect(
      t.mutation(internal.messages.resetActiveThread, { chatId: CHAT }),
    ).resolves.not.toThrow();
  });

  it("is idempotent — no-op when most-recent thread is already idle", async () => {
    const t = convexTest(schema);

    await t.run(async (ctx) => {
      await ctx.db.insert("threads", {
        chatId: CHAT,
        startedAt: NOW,
        lastActiveAt: NOW,
        status: "idle",
      });
    });

    // Should not throw, should not change anything
    await expect(
      t.mutation(internal.messages.resetActiveThread, { chatId: CHAT }),
    ).resolves.not.toThrow();
  });

  it("after reset, resolveThread opens a NEW thread id", async () => {
    const t = convexTest(schema);

    // Open initial thread
    const id1 = await t.mutation(internal.messages.resolveThread, {
      chatId: CHAT,
      now: NOW,
    });

    // Reset it
    await t.mutation(internal.messages.resetActiveThread, { chatId: CHAT });

    // Next message — same NOW (still within idle window) but thread was reset
    const id2 = await t.mutation(internal.messages.resolveThread, {
      chatId: CHAT,
      now: NOW + 1000, // well within THREAD_IDLE_MS
    });

    expect(id2).not.toBe(id1);
    const [old, fresh] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(id1 as Id<"threads">), ctx.db.get(id2 as Id<"threads">)]),
    );
    expect(old!.status).toBe("idle");
    expect(fresh!.status).toBe("active");
  });

  it("thread-continuity: getSessionContext after /new returns only post-reset turns", async () => {
    const t = convexTest(schema);

    // 1. Message arrives → opens thread1
    const thread1Id = await t.mutation(internal.messages.resolveThread, {
      chatId: CHAT,
      now: NOW,
    });
    await t.mutation(internal.messages.logMessage, {
      chatId: CHAT,
      direction: "in",
      text: "pre-reset message",
      threadId: thread1Id as Id<"threads">,
      createdAt: NOW,
    });

    // 2. /new → reset
    await t.mutation(internal.messages.resetActiveThread, { chatId: CHAT });

    // getSessionContext now returns [] — no active thread
    const ctxAfterReset = await t.query(api.messages.getSessionContext, {
      chatId: CHAT,
      limit: 20,
    });
    expect(ctxAfterReset).toEqual([]);

    // 3. Next message → opens thread2
    const thread2Id = await t.mutation(internal.messages.resolveThread, {
      chatId: CHAT,
      now: NOW + 1000,
    });
    await t.mutation(internal.messages.logMessage, {
      chatId: CHAT,
      direction: "in",
      text: "post-reset message",
      threadId: thread2Id as Id<"threads">,
      createdAt: NOW + 1000,
    });

    // 4. getSessionContext returns ONLY the post-reset turn
    const ctxAfterNewMessage = await t.query(api.messages.getSessionContext, {
      chatId: CHAT,
      limit: 20,
    });
    expect(ctxAfterNewMessage).toHaveLength(1);
    expect(ctxAfterNewMessage[0].text).toBe("post-reset message");
  });
});

// ── resolveThread ─────────────────────────────────────────────────────────────

describe("resolveThread", () => {
  it("creates a new thread when none exists", async () => {
    const t = convexTest(schema);

    const threadId = await t.mutation(internal.messages.resolveThread, {
      chatId: CHAT,
      now: NOW,
    });

    expect(typeof threadId).toBe("string");

    const thread = await t.run(async (ctx) => ctx.db.get(threadId as Id<"threads">));
    expect(thread).not.toBeNull();
    expect(thread!.status).toBe("active");
    expect(thread!.chatId).toBe(CHAT);
    expect(thread!.startedAt).toBe(NOW);
  });

  it("reuses the active thread within the idle window", async () => {
    const t = convexTest(schema);

    const id1 = await t.mutation(internal.messages.resolveThread, {
      chatId: CHAT,
      now: NOW,
    });

    const withinWindow = NOW + THREAD_IDLE_MS - 60_000; // 1 min before expiry
    const id2 = await t.mutation(internal.messages.resolveThread, {
      chatId: CHAT,
      now: withinWindow,
    });

    expect(id2).toBe(id1);

    const thread = await t.run(async (ctx) => ctx.db.get(id1 as Id<"threads">));
    expect(thread!.lastActiveAt).toBe(withinWindow);
    expect(thread!.status).toBe("active");
  });

  it("opens a new thread and marks prior idle when outside window", async () => {
    const t = convexTest(schema);

    const id1 = await t.mutation(internal.messages.resolveThread, {
      chatId: CHAT,
      now: NOW,
    });

    const afterWindow = NOW + THREAD_IDLE_MS + 1;
    const id2 = await t.mutation(internal.messages.resolveThread, {
      chatId: CHAT,
      now: afterWindow,
    });

    expect(id2).not.toBe(id1);

    const [old, fresh] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(id1 as Id<"threads">), ctx.db.get(id2 as Id<"threads">)])
    );

    expect(old!.status).toBe("idle");
    expect(fresh!.status).toBe("active");
    expect(fresh!.startedAt).toBe(afterWindow);
  });

  it("does not cross chat threads — different chatIds get separate threads", async () => {
    const t = convexTest(schema);

    const id1 = await t.mutation(internal.messages.resolveThread, {
      chatId: CHAT,
      now: NOW,
    });
    const id2 = await t.mutation(internal.messages.resolveThread, {
      chatId: CHAT2,
      now: NOW,
    });

    expect(id1).not.toBe(id2);
  });
});
