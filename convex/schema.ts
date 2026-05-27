// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  telegramUpdates: defineTable({
    updateId: v.number(),
    receivedAt: v.number(),
  }).index("by_update_id", ["updateId"]),

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
