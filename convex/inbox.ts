// convex/inbox.ts
//
// Knowledge-inbox public surface for the wiki-brain drain worker.
//
// The drain worker calls these over the Convex HTTP API
// (POST /api/query and POST /api/mutation) without authentication —
// these functions are intentionally PUBLIC (no ctx.auth check).
//
// Capture (enqueue) is INTERNAL — only the webhook path calls it.

import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";

// ─── Validator shared by the enqueue args ────────────────────────────────────

const kindValidator = v.union(
  v.literal("url"),
  v.literal("text"),
  v.literal("youtube"),
);

// ─── Public query: listPending ────────────────────────────────────────────────

/**
 * Return pending inbox rows oldest-first, up to `limit`. Shape is intentionally
 * minimal — the drain worker only needs id, category, source, kind, chatId.
 *
 * HTTP path: POST /api/query  body: {"path":"inbox:listPending","args":{"limit":50}}
 */
export const listPending = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("inbox")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(args.limit);

    return rows.map((r) => ({
      id: r._id as string,
      op: r.op,
      category: r.category,
      source: r.source,
      kind: r.kind,
      chatId: r.chatId,
    }));
  },
});

// ─── Public mutation: markDrained ─────────────────────────────────────────────

/**
 * Mark a batch of inbox rows as drained. Idempotent — rows already drained are
 * silently skipped (the drain worker may retry on network error).
 *
 * HTTP path: POST /api/mutation  body: {"path":"inbox:markDrained","args":{"ids":[...]}}
 */
export const markDrained = mutation({
  args: { ids: v.array(v.id("inbox")) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (!row || row.status === "drained") continue;
      await ctx.db.patch(id, { status: "drained" });
    }
  },
});

// ─── Internal mutation: enqueue ───────────────────────────────────────────────

/**
 * Insert a new pending inbox row. Called only from the capture action scheduled
 * by buildHandleTelegramWebhook — never from client code.
 */
export const enqueue = internalMutation({
  args: {
    category: v.string(),
    source: v.string(),
    kind: kindValidator,
    chatId: v.string(),
    raw: v.optional(v.string()),
    op: v.optional(v.union(v.literal("save"), v.literal("ask"))),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("inbox", {
      category: args.category,
      source: args.source,
      kind: args.kind,
      status: "pending",
      createdAt: Date.now(),
      chatId: args.chatId,
      raw: args.raw,
      op: args.op,
    });
  },
});
