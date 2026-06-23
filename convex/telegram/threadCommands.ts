// convex/telegram/threadCommands.ts
//
// Thread-lifecycle commands: /new — reset the active thread so the next
// inbound message opens a fresh session (prior context not carried over).
//
// Follows the same factory pattern as registryCommands.ts:
//   buildThreadCommands(scheduler) → CommandRegistration[]
//
// Routing: command intent logs to messages but is NOT captured to the inbox
// (matches behaviour of /register and /start).

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Scheduler } from "convex/server";
import type { CommandRegistration } from "./commands";
import { sendTelegramHtml } from "../lib/telegramHtml";

const NEW_ACK_HTML =
  "🆕 Fresh thread started — I won't carry over the previous conversation. What's next?";

export function buildThreadCommands(scheduler: Scheduler): CommandRegistration[] {
  return [
    {
      name: "new",
      dispatch: async (msg) => {
        // Schedule a single internalAction that does:
        //   1. resetActiveThread (mutation)
        //   2. log the command turn (mutation)
        //   3. send the ack (Telegram API call)
        // Mirrors how replyStartHelp is scheduled from buildRegistryCommands.
        await scheduler.runAfter(0, internal.telegram.threadCommands.handleNew, {
          chatId: msg.chatId,
          text: msg.text,
        });
      },
    },
  ];
}

// ── Internal action: reset + ack ──────────────────────────────────────────────

export const handleNew = internalAction({
  args: { chatId: v.string(), text: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const now = Date.now();

    // 1. Mark the active thread idle — next message resolves a new thread.
    await ctx.runMutation(internal.messages.resetActiveThread, {
      chatId: args.chatId,
    });

    // 2. Log the /new command turn (intent: "command", direction "in").
    await ctx.runMutation(internal.messages.logMessage, {
      chatId: args.chatId,
      direction: "in",
      text: args.text,
      intent: "command",
      op: "new",
      createdAt: now,
    });

    // 3. Send the ack via sendTelegramHtml (same path as replyStartHelp).
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.warn("[threadCommands] TELEGRAM_BOT_TOKEN not set — cannot send /new ack");
      return;
    }
    try {
      await sendTelegramHtml(token, args.chatId, NEW_ACK_HTML);
    } catch (err) {
      console.warn("[threadCommands] sendTelegramHtml failed for /new ack", err);
    }
  },
});
