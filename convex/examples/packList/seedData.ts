// convex/examples/packList/seedData.ts
import { internalMutation } from "../../_generated/server";

const DEMO_ORDER_NUMBERS = ["0527-001", "0527-002", "0529-001"] as const;

/**
 * Resets the 3 demo orders so `/pack` works immediately. Idempotent.
 *
 * I10 SAFETY: this mutation ONLY wipes rows whose `orderNumber` matches the
 * 3 known-demo values. If you've adapted this starter for real data, your
 * production rows are NOT touched. Renamed from `seed` → `resetDemoData` to
 * make destructive intent obvious at call sites.
 *
 * Run: `npx convex run examples/packList/seedData:resetDemoData`
 */
export const resetDemoData = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Targeted wipe — only the 3 demo orders (and their items).
    for (const orderNumber of DEMO_ORDER_NUMBERS) {
      const existing = await ctx.db
        .query("orders")
        .filter((q) => q.eq(q.field("orderNumber"), orderNumber))
        .collect();
      for (const o of existing) {
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", o._id))
          .collect();
        for (const i of items) await ctx.db.delete(i._id);
        await ctx.db.delete(o._id);
      }
    }

    const today = Date.now();
    const inEightHours = today + 8 * 3600_000;
    const inSixteenHours = today + 16 * 3600_000;
    const inTwoDays = today + 2 * 86400_000;

    const a = await ctx.db.insert("orders", {
      orderNumber: "0527-001",
      customerName: "Customer A",
      status: "pending",
      dueDate: inEightHours,
      deliveryType: "delivery",
      deliveryAddress: "123 Maple Street, Suburb",
      expedited: true,
    });
    await ctx.db.insert("orderItems", { orderId: a, productName: "Product A", quantity: 2 });
    await ctx.db.insert("orderItems", { orderId: a, productName: "Combo B", quantity: 1 });

    const b = await ctx.db.insert("orders", {
      orderNumber: "0527-002",
      customerName: "Customer B",
      status: "in_progress",
      dueDate: inSixteenHours,
      deliveryType: "pickup",
      notes: "Ring buzzer 4B",
    });
    await ctx.db.insert("orderItems", { orderId: b, productName: "Combo B", quantity: 3 });

    // This one is future — should NOT appear on today's pack list
    const c = await ctx.db.insert("orders", {
      orderNumber: "0529-001",
      customerName: "Customer C (future)",
      status: "pending",
      dueDate: inTwoDays,
      deliveryType: "delivery",
      deliveryAddress: "999 Future Lane",
    });
    await ctx.db.insert("orderItems", { orderId: c, productName: "Product A", quantity: 1 });

    return { resetOrders: 3, expectedOnPackList: 2 };
  },
});
