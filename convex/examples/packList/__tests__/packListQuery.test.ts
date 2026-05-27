import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";

// convex-test discovers function modules via the modules manifest. With
// `server: { deps: { inline: ['convex-test'] } }` in vitest.config and edge-runtime
// environment, convexTest(schema) auto-loads all functions under convex/.

const TZ = "Asia/Jakarta";

function localMidnight(year: number, month1Indexed: number, day: number, timeZone: string): number {
  const utcGuess = Date.UTC(year, month1Indexed - 1, day, 0, 0, 0, 0);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" });
  const parts = fmt.formatToParts(new Date(utcGuess));
  const offsetPart = parts.find(p => p.type === "timeZoneName")?.value ?? "GMT";
  const m = offsetPart.match(/GMT([+-]\d+)(?::(\d+))?/);
  const hours = m ? parseInt(m[1]!, 10) : 0;
  const mins = m && m[2] ? parseInt(m[2]!, 10) * Math.sign(hours || 1) : 0;
  return utcGuess - (hours * 60 + mins) * 60_000;
}

const TODAY_START = localMidnight(2026, 5, 27, TZ);
const TOMORROW_START = localMidnight(2026, 5, 28, TZ);
const YESTERDAY_START = localMidnight(2026, 5, 26, TZ);
const NOON_TODAY = TODAY_START + 12 * 3600_000;

describe("getOrdersForPackList", () => {
  it("returns empty result when no orders exist", async () => {
    const t = convexTest(schema);
    const result = await t.query(internal.examples.packList.packListQuery.getOrdersForPackList, {
      now: NOON_TODAY, timeZone: TZ,
    });
    expect(result.totalCount).toBe(0);
    expect(result.orders).toEqual([]);
    expect(result.deliveryCount).toBe(0);
    expect(result.pickupCount).toBe(0);
  });

  it("returns a pending order with dueDate today", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const oid = await ctx.db.insert("orders", {
        orderNumber: "001", customerName: "Customer A",
        status: "pending", dueDate: TODAY_START + 8 * 3600_000,
        deliveryType: "delivery", deliveryAddress: "1 Main",
      });
      await ctx.db.insert("orderItems", { orderId: oid, productName: "Product A", quantity: 2 });
    });
    const result = await t.query(internal.examples.packList.packListQuery.getOrdersForPackList, {
      now: NOON_TODAY, timeZone: TZ,
    });
    expect(result.totalCount).toBe(1);
    expect(result.orders[0]?.orderNumber).toBe("001");
    expect(result.orders[0]?.items).toEqual([{ productName: "Product A", quantity: 2 }]);
  });

  it("excludes orders with dueDate in the future (after end-of-today)", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orders", {
        orderNumber: "FUTURE", customerName: "Future Customer",
        status: "pending", dueDate: TOMORROW_START + 8 * 3600_000,
        deliveryType: "delivery", deliveryAddress: "X",
      });
    });
    const result = await t.query(internal.examples.packList.packListQuery.getOrdersForPackList, {
      now: NOON_TODAY, timeZone: TZ,
    });
    expect(result.totalCount).toBe(0);
  });

  it("excludes orders with undefined dueDate (post-collect filter)", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orders", {
        orderNumber: "NO-DUE", customerName: "No Due",
        status: "pending",
        // dueDate intentionally absent
        deliveryType: "pickup",
      });
    });
    const result = await t.query(internal.examples.packList.packListQuery.getOrdersForPackList, {
      now: NOON_TODAY, timeZone: TZ,
    });
    expect(result.totalCount).toBe(0);
  });

  it("excludes done and cancelled orders", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orders", {
        orderNumber: "DONE", customerName: "C",
        status: "done", dueDate: TODAY_START + 8 * 3600_000,
        deliveryType: "delivery", deliveryAddress: "X",
      });
      await ctx.db.insert("orders", {
        orderNumber: "CANCEL", customerName: "C",
        status: "cancelled", dueDate: TODAY_START + 8 * 3600_000,
        deliveryType: "delivery", deliveryAddress: "X",
      });
    });
    const result = await t.query(internal.examples.packList.packListQuery.getOrdersForPackList, {
      now: NOON_TODAY, timeZone: TZ,
    });
    expect(result.totalCount).toBe(0);
  });

  it("includes BOTH pending and in_progress statuses", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orders", {
        orderNumber: "P", customerName: "P",
        status: "pending", dueDate: TODAY_START + 8 * 3600_000,
        deliveryType: "delivery", deliveryAddress: "X",
      });
      await ctx.db.insert("orders", {
        orderNumber: "IP", customerName: "IP",
        status: "in_progress", dueDate: TODAY_START + 9 * 3600_000,
        deliveryType: "pickup",
      });
    });
    const result = await t.query(internal.examples.packList.packListQuery.getOrdersForPackList, {
      now: NOON_TODAY, timeZone: TZ,
    });
    expect(result.totalCount).toBe(2);
    expect(result.deliveryCount).toBe(1);
    expect(result.pickupCount).toBe(1);
  });

  it("filters out cancelled order items but keeps the order", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const oid = await ctx.db.insert("orders", {
        orderNumber: "MIX", customerName: "Mix",
        status: "pending", dueDate: TODAY_START + 8 * 3600_000,
        deliveryType: "delivery", deliveryAddress: "1 Main",
      });
      await ctx.db.insert("orderItems", { orderId: oid, productName: "Product A", quantity: 1 });
      await ctx.db.insert("orderItems", { orderId: oid, productName: "Cancelled Combo", quantity: 1, isCancelled: true });
    });
    const result = await t.query(internal.examples.packList.packListQuery.getOrdersForPackList, {
      now: NOON_TODAY, timeZone: TZ,
    });
    expect(result.totalCount).toBe(1);
    expect(result.orders[0]?.items).toHaveLength(1);
    expect(result.orders[0]?.items[0]?.productName).toBe("Product A");
  });

  it("sorts expedited orders BEFORE non-expedited, regardless of dueDate", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orders", {
        orderNumber: "NORMAL-EARLIER", customerName: "N",
        status: "pending", dueDate: TODAY_START + 8 * 3600_000,
        deliveryType: "pickup", expedited: false,
      });
      await ctx.db.insert("orders", {
        orderNumber: "RUSH-LATER", customerName: "R",
        status: "pending", dueDate: TODAY_START + 14 * 3600_000,
        deliveryType: "pickup", expedited: true,
      });
    });
    const result = await t.query(internal.examples.packList.packListQuery.getOrdersForPackList, {
      now: NOON_TODAY, timeZone: TZ,
    });
    expect(result.orders[0]?.orderNumber).toBe("RUSH-LATER");
    expect(result.orders[1]?.orderNumber).toBe("NORMAL-EARLIER");
  });

  it("includes orders dated yesterday if still pending (overdue catch)", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orders", {
        orderNumber: "OVERDUE", customerName: "O",
        status: "in_progress", dueDate: YESTERDAY_START + 8 * 3600_000,
        deliveryType: "delivery", deliveryAddress: "1",
      });
    });
    const result = await t.query(internal.examples.packList.packListQuery.getOrdersForPackList, {
      now: NOON_TODAY, timeZone: TZ,
    });
    expect(result.totalCount).toBe(1);
    expect(result.orders[0]?.orderNumber).toBe("OVERDUE");
  });
});
