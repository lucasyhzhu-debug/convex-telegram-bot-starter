// convex/telegram/webhook.ts
import { v } from "convex/values";
import { httpAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { constantTimeEqual } from "../lib/constantTimeEqual";
import { buildCommandMatcher, type CommandRegistration } from "./commands";

interface WebhookResult { status: number; body: string }

export interface WebhookDeps {
  /** R5: atomic dedupe. Returns true iff THIS call inserted the row. */
  recordIfNew: (updateId: number) => Promise<boolean>;
  /** Matcher built from the example app's command registrations. */
  match: (text: string) => { command: CommandRegistration } | null;
}

interface TelegramUpdate {
  update_id?: number;
  message?: { message_id?: number; text?: string; chat?: { id?: number; type?: string }; from?: { id?: number } };
}

/**
 * Pure handler — no Convex runtime dependency. The httpAction wires `ctx` into
 * `deps`. Exported separately so it's unit-testable without convex-test.
 */
export async function decideWebhookOutcome(input: {
  providedSecret: string | null;
  expectedSecret: string | undefined;
  body: TelegramUpdate;
  deps: WebhookDeps;
}): Promise<WebhookResult> {
  if (!input.expectedSecret || !input.providedSecret) {
    return { status: 401, body: "unauthorized" };
  }
  if (!constantTimeEqual(input.providedSecret, input.expectedSecret)) {
    return { status: 401, body: "unauthorized" };
  }

  const updateId = input.body.update_id;
  const text = input.body.message?.text;
  if (typeof updateId !== "number") return { status: 200, body: "ok" };
  if (typeof text !== "string") return { status: 200, body: "ok" };

  const match = input.deps.match(text);
  if (!match) return { status: 200, body: "ok" };

  const isNew = await input.deps.recordIfNew(updateId);
  if (!isNew) return { status: 200, body: "ok" };

  // C3: never return non-200 once we've already committed the dedupe row. If
  // dispatch throws, retries will see the row exists and skip — turning the
  // transient error into a permanent 500 loop. ACK 200 and log instead.
  try {
    await match.command.dispatch();
  } catch (err) {
    console.warn("[telegram] dispatch failed after recordIfNew committed", err);
  }
  return { status: 200, body: "ok" };
}

// ── Convex glue: atomic dedupe + httpAction ──────────────────────────────────

export const recordIfNew = internalMutation({
  args: { updateId: v.number() },
  handler: async (ctx, args): Promise<boolean> => {
    const existing = await ctx.db
      .query("telegramUpdates")
      .withIndex("by_update_id", (q) => q.eq("updateId", args.updateId))
      .unique();
    if (existing) return false;
    await ctx.db.insert("telegramUpdates", {
      updateId: args.updateId,
      receivedAt: Date.now(),
    });
    return true;
  },
});

/**
 * Build the httpAction. Example apps call this once at boot, passing a factory
 * that — given the request-scoped `Scheduler` — returns the command registry.
 * The factory pattern is required because `dispatch` typically calls
 * `scheduler.runAfter(...)`, and `ctx.scheduler` is only valid INSIDE the
 * httpAction (not at module scope).
 *
 * Defined in this task with the final factory signature (not rewritten later)
 * so the webhook tests below match the shipped shape.
 */
import type { Scheduler } from "convex/server";

export function buildHandleTelegramWebhook(
  buildRegistrations: (scheduler: Scheduler) => CommandRegistration[],
) {
  return httpAction(async (ctx, request) => {
    let body: TelegramUpdate;
    try {
      body = (await request.json()) as TelegramUpdate;
    } catch {
      return new Response("bad request", { status: 400 });
    }
    const registrations = buildRegistrations(ctx.scheduler);
    const match = buildCommandMatcher(registrations);
    const outcome = await decideWebhookOutcome({
      providedSecret: request.headers.get("X-Telegram-Bot-Api-Secret-Token"),
      expectedSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
      body,
      deps: {
        recordIfNew: (updateId) =>
          ctx.runMutation(internal.telegram.webhook.recordIfNew, { updateId }),
        match,
      },
    });
    return new Response(outcome.body, { status: outcome.status });
  });
}
