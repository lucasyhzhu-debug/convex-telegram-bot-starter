// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  telegramUpdates: defineTable({
    updateId: v.number(),
    receivedAt: v.number(),
  }).index("by_update_id", ["updateId"]),
});
