// convex/messages.ts
//
// Message log and thread session surface.
//
// Public queries (no auth check — intentionally open to wiki-brain drain worker):
//   getSessionContext — recent turns in the active thread for a chat
//   listSince         — all messages since a timestamp (for weekly review)
//
// Internal mutations (called from captureAndAck and /post-message):
//   logMessage    — append a message row
//   resolveThread — get or create the active thread for a chat

import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ── Thread session window ─────────────────────────────────────────────────────

/** A thread is considered "active" if the last message arrived within this window. */
export const THREAD_IDLE_MS = 3 * 60 * 60 * 1000; // 3 hours

// ── Internal mutations ────────────────────────────────────────────────────────

/**
 * Mark the chat's most-recent active thread as "idle" so the next inbound
 * message opens a fresh thread via resolveThread. Idempotent: no-op when no
 * active thread exists.
 */
export const resetActiveThread = internalMutation({
  args: { chatId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const recent = await ctx.db
      .query("threads")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .order("desc")
      .first();

    if (!recent || recent.status !== "active") return; // idempotent no-op
    await ctx.db.patch(recent._id, { status: "idle" });
  },
});

/**
 * Resolve the active thread for a chat, creating or reusing as needed.
 * Returns the thread Id.
 *
 * Rules:
 * - If the most-recent thread for the chat has lastActiveAt within THREAD_IDLE_MS
 *   of `now`, reuse it (keep status "active", bump lastActiveAt).
 * - Otherwise, mark the prior thread "idle" (if any) and open a new "active" one.
 */
export const resolveThread = internalMutation({
  args: { chatId: v.string(), now: v.number() },
  returns: v.id("threads"),
  handler: async (ctx, args): Promise<Id<"threads">> => {
    const recent = await ctx.db
      .query("threads")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .order("desc")
      .first();

    if (
      recent &&
      recent.status === "active" &&
      args.now - recent.lastActiveAt < THREAD_IDLE_MS
    ) {
      await ctx.db.patch(recent._id, { lastActiveAt: args.now });
      return recent._id;
    }

    // Mark prior thread idle if it was still "active"
    if (recent && recent.status === "active") {
      await ctx.db.patch(recent._id, { status: "idle" });
    }

    // Open a new thread
    const id = await ctx.db.insert("threads", {
      chatId: args.chatId,
      startedAt: args.now,
      lastActiveAt: args.now,
      status: "active",
    });
    return id;
  },
});

/**
 * Append a message row. Called from captureAndAck (direction "in") and from
 * the /post-message send path (direction "out").
 */
export const logMessage = internalMutation({
  args: {
    chatId: v.string(),
    direction: v.union(v.literal("in"), v.literal("out")),
    text: v.string(),
    intent: v.optional(
      v.union(
        v.literal("save"),
        v.literal("ask"),
        v.literal("command"),
        v.literal("other"),
      ),
    ),
    op: v.optional(v.string()),
    threadId: v.optional(v.id("threads")),
    updateId: v.optional(v.number()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      chatId: args.chatId,
      direction: args.direction,
      text: args.text,
      intent: args.intent,
      op: args.op,
      threadId: args.threadId,
      updateId: args.updateId,
      createdAt: args.createdAt,
    });
  },
});

// ── Public queries ────────────────────────────────────────────────────────────

/**
 * Return the active thread's recent turns oldest-first as [{direction, text, createdAt}].
 * Used by wiki-brain before answering a question so follow-ups stay coherent.
 *
 * HTTP path: POST /api/query  body: {"path":"messages:getSessionContext","args":{"chatId":"...","limit":20}}
 */
export const getSessionContext = query({
  args: { chatId: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .order("desc")
      .first();

    if (!thread || thread.status !== "active") return [];

    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_chat_created", (q) => q.eq("chatId", args.chatId))
      .order("asc")
      .filter((q) => q.eq(q.field("threadId"), thread._id))
      .collect();

    const limited = msgs.slice(-args.limit);
    return limited.map((m) => ({
      direction: m.direction,
      text: m.text,
      createdAt: m.createdAt,
    }));
  },
});

/**
 * Return all messages with createdAt >= sinceMs, oldest-first, limited to `limit`.
 * Used by the agentic weekly review.
 *
 * HTTP path: POST /api/query  body: {"path":"messages:listSince","args":{"sinceMs":...,"limit":500}}
 */
export const listSince = query({
  args: { sinceMs: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_created", (q) => q.gte("createdAt", args.sinceMs))
      .order("asc")
      .take(args.limit);

    return rows.map((m) => ({
      chatId: m.chatId,
      direction: m.direction,
      text: m.text,
      intent: m.intent,
      op: m.op,
      createdAt: m.createdAt,
    }));
  },
});
