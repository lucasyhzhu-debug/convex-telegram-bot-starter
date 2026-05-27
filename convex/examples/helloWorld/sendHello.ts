// convex/examples/helloWorld/sendHello.ts
import { v } from "convex/values";
import type { Scheduler } from "convex/server";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { sendTelegramHtml } from "../../lib/telegramHtml";
import { formatHello } from "./helloFormat";
import type { CommandRegistration } from "../../telegram/commands";

export const sendHello = internalAction({
  args: { reason: v.union(v.literal("cron"), v.literal("command")) },
  // Explicit return type — avoids the circular inference loop with `internal.*`.
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      throw new Error("Telegram env vars missing (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)");
    }
    // `args.reason` is already typed `"cron" | "command"` (= `HelloReason`)
    // by Convex's arg validator — no cast needed.
    const chunks = formatHello({ reason: args.reason, generatedAt: Date.now() });
    // Single chunk always — no partial-send breadcrumb needed here.
    // See `convex/examples/packList/sendPackList.ts` for the multi-chunk
    // pattern with `sendChunksWithBreadcrumb`.
    for (const chunk of chunks) {
      await sendTelegramHtml(token, chatId, chunk);
    }
    return { ok: true };
  },
});

/**
 * Command registrations. Called by `convex/http.ts` with the request-scoped
 * `Scheduler` (only valid inside an httpAction). `dispatch` schedules
 * `sendHello` with `reason: "command"`.
 */
export function buildHelloWorldCommands(scheduler: Scheduler): CommandRegistration[] {
  return [{
    name: "ping",
    dispatch: async () => {
      await scheduler.runAfter(0, internal.examples.helloWorld.sendHello.sendHello, { reason: "command" });
    },
  }];
}
