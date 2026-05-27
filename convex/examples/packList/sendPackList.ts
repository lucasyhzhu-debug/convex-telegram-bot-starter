// convex/examples/packList/sendPackList.ts
import { v } from "convex/values";
import type { Scheduler } from "convex/server";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { sendTelegramHtml } from "../../lib/telegramHtml";
import { formatPackList } from "./packListFormat";
import type { CommandRegistration } from "../../telegram/commands";

export const sendPackList = internalAction({
  args: {
    reason: v.union(v.literal("morning"), v.literal("midday"), v.literal("command")),
  },
  handler: async (ctx, args): Promise<{ chunkCount: number; orderCount: number }> => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const timeZone = process.env.PACK_LIST_TIMEZONE ?? "UTC";
    if (!token || !chatId) {
      throw new Error("Telegram env vars missing (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)");
    }

    const data = await ctx.runQuery(
      internal.examples.packList.packListQuery.getOrdersForPackList,
      { timeZone },
    );
    const chunks = formatPackList({
      reason: args.reason,
      orders: data.orders,
      counts: { total: data.totalCount, delivery: data.deliveryCount, pickup: data.pickupCount },
      generatedAt: Date.now(),
      timeZone,
    });

    await sendChunksWithBreadcrumb(chunks, (text) => sendTelegramHtml(token, chatId, text));

    return { chunkCount: chunks.length, orderCount: data.totalCount };
  },
});

/** Command registrations for this example. Wired into `convex/http.ts`. */
export function buildPackListCommands(scheduler: Scheduler): CommandRegistration[] {
  return [{
    name: "pack",
    dispatch: async () => {
      await scheduler.runAfter(0, internal.examples.packList.sendPackList.sendPackList, { reason: "command" });
    },
  }];
}

/**
 * Send `chunks` sequentially. On failure mid-send, attempts to send a
 * breadcrumb warning so the chat operator knows partial output landed,
 * then re-throws. `send` matches `sendTelegramHtml`'s signature except
 * the (token, chatId) are pre-bound by the caller.
 *
 * Exported for testing — see __tests__/sendPackList.test.ts.
 */
export async function sendChunksWithBreadcrumb(
  chunks: string[],
  send: (text: string) => Promise<{ message_id: number }>,
): Promise<void> {
  let sentCount = 0;
  try {
    for (const chunk of chunks) {
      await send(chunk);
      sentCount++;
    }
  } catch (err) {
    if (sentCount > 0) {
      try {
        await send(
          `<i>⚠️ Pack list send failed after ${sentCount}/${chunks.length} chunks. Check Convex logs.</i>`,
        );
      } catch (breadcrumbErr) {
        // Breadcrumb is best-effort, but silently swallowing the failure creates
        // a debug black hole — log it so the operator can see both the original
        // failure AND that the user-visible breadcrumb didn't make it through.
        console.warn("[pack-list] breadcrumb send also failed", breadcrumbErr);
      }
    }
    throw err;
  }
}
