// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  telegramUpdates: defineTable({
    updateId: v.number(),
    receivedAt: v.number(),
  }).index("by_update_id", ["updateId"]),

  // ── Self-registration registry (v2) ────────────────────────────────────────
  // One row per Telegram chat that has sent /register@<bot>. A row earns a
  // `role` (from KNOWN_TELEGRAM_ROLES) via the admin UI; send-actions then resolve
  // role → chatId at send time. This replaces the single TELEGRAM_CHAT_ID env var
  // with a managed, multi-destination routing table. See SELF-REGISTRATION.md.
  telegramChats: defineTable({
    // identity (immutable post-registration)
    chatId: v.string(),            // string sidesteps the -100… supergroup number range
    chatType: v.union(
      v.literal("private"),
      v.literal("group"),
      v.literal("supergroup"),
    ),
    title: v.string(),
    // role assignment (mutable via admin UI; validated in app code, not schema,
    // so adding a role to config.ts needs no migration)
    role: v.optional(v.string()),
    // provenance
    registeredBy: v.optional(v.number()),  // Telegram user id who sent /register
    registeredAt: v.number(),
    lastSeenAt: v.number(),
    // operational state
    archivedAt: v.optional(v.number()),
    lastError: v.optional(v.object({ at: v.number(), message: v.string() })),
  })
    .index("by_chatId", ["chatId"])               // unique lookup for upsert + guards
    .index("by_role_archived", ["role", "archivedAt"]), // role lookup + active-list
  // by_role_archived is a single compound index covering BOTH access paths
  // (getChatIdByRole and the active-chat list). A bare by_role index would push
  // `archivedAt === undefined` into a post-scan .filter() — and because undefined
  // sorts BEFORE defined values, an archivedAt-only index is unsafe. Avoid both.

  // Pack-list example schema. Generic on purpose — real apps should rename.
  orders: defineTable({
    orderNumber: v.string(),
    customerName: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("done"),
      v.literal("cancelled"),
    ),
    dueDate: v.optional(v.number()),     // UTC ms
    deliveryType: v.union(v.literal("delivery"), v.literal("pickup")),
    deliveryAddress: v.optional(v.string()),
    notes: v.optional(v.string()),
    expedited: v.optional(v.boolean()),
  })
    .index("by_status_due_date", ["status", "dueDate"]),

  orderItems: defineTable({
    orderId: v.id("orders"),
    productName: v.string(),
    quantity: v.number(),
    isCancelled: v.optional(v.boolean()),
  })
    .index("by_order", ["orderId"]),
});
