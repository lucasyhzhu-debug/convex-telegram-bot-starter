// convex/examples/packList/seedData.ts
import { internalMutation } from "../../_generated/server";
import { noonLocalTodayMs } from "../../lib/dateAnchors";

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
    // Full-table scan is fine for 3 demo rows. For production-scale wipes,
    // add a `by_orderNumber` index to `orders` and use `withIndex` instead.
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

    // Anchor demo due dates to LOCAL noon (in PACK_LIST_TIMEZONE) so the
    // README's "expect 2 orders" promise holds regardless of when the seed
    // runs — `Date.now()`-relative offsets would silently push Order A past
    // end-of-today if seeded in the late afternoon.
    const timeZone = process.env.PACK_LIST_TIMEZONE ?? "UTC";
    const noonToday = noonLocalTodayMs(timeZone);
    const localFourPm = noonToday + 4 * 3600_000;   // 16:00 local — inside today's window
    const localSixPm = noonToday + 6 * 3600_000;    // 18:00 local — inside today's window
    const dayAfterTomorrow = noonToday + 36 * 3600_000; // ~midnight day-after-tomorrow local — outside today's window

    const a = await ctx.db.insert("orders", {
      orderNumber: "0527-001",
      customerName: "Customer A",
      status: "pending",
      dueDate: localFourPm,
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
      dueDate: localSixPm,
      deliveryType: "pickup",
      notes: "Ring buzzer 4B",
    });
    await ctx.db.insert("orderItems", { orderId: b, productName: "Combo B", quantity: 3 });

    // This one is future — should NOT appear on today's pack list
    const c = await ctx.db.insert("orders", {
      orderNumber: "0529-001",
      customerName: "Customer C (future)",
      status: "pending",
      dueDate: dayAfterTomorrow,
      deliveryType: "delivery",
      deliveryAddress: "999 Future Lane",
    });
    await ctx.db.insert("orderItems", { orderId: c, productName: "Product A", quantity: 1 });

    return { resetOrders: 3, expectedOnPackList: 2 };
  },
});
