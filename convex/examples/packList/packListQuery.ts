// convex/examples/packList/packListQuery.ts
import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import type { PackOrder } from "./packListFormat";

const ACTIVE_STATUSES = ["pending", "in_progress"] as const;

/**
 * Returns orders to pack:
 *   - status ∈ {pending, in_progress}
 *   - dueDate is SET (post-collect filter — see comment below)
 *   - dueDate <= end of "today" in the configured timezone
 *
 * `now` and `timeZone` are injectable for tests. Production callers pass nothing.
 */
export const getOrdersForPackList = internalQuery({
  args: {
    now: v.optional(v.number()),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const tz = args.timeZone ?? "UTC";
    const endOfTodayMs = endOfDayInTimeZone(now, tz);

    // Convex stores absent optional fields as `undefined`, and undefined sorts
    // BEFORE all numeric values in an index — so `.lte("dueDate", X)` includes
    // unset rows. Filter them out explicitly after collecting.
    const collected: Doc<"orders">[] = [];
    for (const status of ACTIVE_STATUSES) {
      const slice = await ctx.db
        .query("orders")
        .withIndex("by_status_due_date", (q) =>
          q.eq("status", status).lte("dueDate", endOfTodayMs),
        )
        .collect();
      for (const o of slice) if (o.dueDate !== undefined) collected.push(o);
    }

    collected.sort((a, b) => {
      const ea = a.expedited ? 0 : 1;
      const eb = b.expedited ? 0 : 1;
      if (ea !== eb) return ea - eb;
      const da = a.dueDate ?? Infinity;
      const db = b.dueDate ?? Infinity;
      if (da !== db) return da - db;
      return a._creationTime - b._creationTime;
    });

    const orders: PackOrder[] = [];
    let deliveryCount = 0;
    let pickupCount = 0;
    for (const order of collected) {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q) => q.eq("orderId", order._id))
        .collect();
      const live = items.filter((i) => !i.isCancelled);
      orders.push({
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        items: live.map((i) => ({ productName: i.productName, quantity: i.quantity })),
        deliveryType: order.deliveryType,
        deliveryAddress: order.deliveryAddress,
        notes: order.notes,
        expedited: order.expedited,
        dueDate: order.dueDate,
      });
      if (order.deliveryType === "delivery") deliveryCount++;
      else pickupCount++;
    }

    return {
      totalCount: orders.length,
      deliveryCount,
      pickupCount,
      orders,
    };
  },
});

/** End-of-local-day in the given IANA timezone, as UTC ms. */
function endOfDayInTimeZone(nowUtcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(nowUtcMs)).map(p => [p.type, p.value]));
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  // Start of next local day, as UTC ms — then subtract 1ms.
  const nextLocalMidnight = startOfLocalDay(y, m, d + 1, timeZone);
  return nextLocalMidnight - 1;
}

function startOfLocalDay(year: number, month1Indexed: number, day: number, timeZone: string): number {
  const utcGuess = Date.UTC(year, month1Indexed - 1, day, 0, 0, 0, 0);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" });
  const parts = fmt.formatToParts(new Date(utcGuess));
  const offsetPart = parts.find(p => p.type === "timeZoneName")?.value ?? "GMT";
  const m = offsetPart.match(/GMT([+-]\d+)(?::(\d+))?/);
  const hours = m ? parseInt(m[1]!, 10) : 0;
  const mins = m && m[2] ? parseInt(m[2]!, 10) * Math.sign(hours || 1) : 0;
  return utcGuess - (hours * 60 + mins) * 60_000;
}
