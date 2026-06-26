// convex/telegram/webhook.ts
import { v } from "convex/values";
import { httpAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { constantTimeEqual } from "../lib/constantTimeEqual";
import {
  buildCommandMatcher,
  type CommandRegistration,
  type MessageContext,
} from "./commands";

interface WebhookResult { status: number; body: string }

export interface DocumentInfo {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
  /** True when this came from a native photo (message.photo) rather than a file attachment. */
  isImage?: boolean;
}

export interface WebhookDeps {
  /** R5: atomic dedupe. Returns true iff THIS call inserted the row. */
  recordIfNew: (updateId: number) => Promise<boolean>;
  /** Matcher built from the app's command registrations. */
  match: (text: string) => { command: CommandRegistration } | null;
  /**
   * Optional (v2): called best-effort for every NON-command message (any text
   * that isn't a known slash command, plus non-text updates). Wire this to
   * touchChatLastSeen when using the self-registration registry so the admin UI
   * shows live "last seen" stamps. Omit it for the simple single-chat setup.
   * Never deduped, never blocks the 200 ACK.
   */
  onNonCommandMessage?: (msg: MessageContext) => Promise<void>;
  /**
   * Optional (knowledge-inbox): deduped capture for non-command text messages
   * and document (file) uploads. Called AFTER recordIfNew returns true (i.e.,
   * this is the first delivery of this update_id). Must not throw — wrap errors
   * internally. Receives the full message context, the update_id, and an
   * optional document descriptor (present for file uploads, absent for text).
   * Scheduled best-effort; never blocks the 200 ACK.
   */
  capture?: (msg: MessageContext, updateId: number, document?: DocumentInfo) => Promise<void>;
}

interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    photo?: Array<{
      file_id: string;
      file_unique_id?: string;
      width?: number;
      height?: number;
      file_size?: number;
    }>;
    chat?: { id?: number; type?: string; title?: string };
    from?: { id?: number };
  };
}

/** Coerce Telegram's chat.type string to our union, defaulting to "group". */
function normalizeChatType(t: string | undefined): MessageContext["chatType"] {
  return t === "private" || t === "group" || t === "supergroup" ? t : "group";
}

/**
 * Pure handler — no Convex runtime dependency. The httpAction wires `ctx` into
 * `deps`. Exported separately so it's unit-testable without convex-test.
 *
 * Message routing matrix:
 *   non-text update      → best-effort touch, no dedupe, 200
 *   unknown slash cmd    → silent 200, no touch, no capture
 *   known command        → dedupe via recordIfNew, then dispatch
 *   regular text         → best-effort touch; if capture dep provided,
 *                          ALSO dedupe via recordIfNew then call capture
 */
export async function decideWebhookOutcome(input: {
  providedSecret: string | null;
  expectedSecret: string | undefined;
  body: TelegramUpdate;
  deps: WebhookDeps;
}): Promise<WebhookResult> {
  // Auth — 401 before any state change.
  if (!input.expectedSecret || !input.providedSecret) {
    return { status: 401, body: "unauthorized" };
  }
  if (!constantTimeEqual(input.providedSecret, input.expectedSecret)) {
    return { status: 401, body: "unauthorized" };
  }

  const updateId = input.body.update_id;
  const msg = input.body.message;
  if (typeof updateId !== "number") return { status: 200, body: "ok" };
  if (!msg) return { status: 200, body: "ok" };

  const chatIdNum = msg.chat?.id;
  if (typeof chatIdNum !== "number") return { status: 200, body: "ok" };

  const ctx: MessageContext = {
    chatId: String(chatIdNum),
    chatType: normalizeChatType(msg.chat?.type),
    title: msg.chat?.title ?? "(untitled)",
    fromId: msg.from?.id,
    text: typeof msg.text === "string" ? msg.text : "",
  };

  // Best-effort lastSeen stamp — non-critical, never blocks the 200 ACK.
  const tryTouch = async () => {
    if (!input.deps.onNonCommandMessage) return;
    try { await input.deps.onNonCommandMessage(ctx); } catch { /* best-effort */ }
  };

  // Document (file upload) — dedupe + capture, then 200.
  // A document message has msg.document but no msg.text (caption lives in msg.caption).
  if (msg.document && typeof msg.document.file_id === "string") {
    const doc: DocumentInfo = {
      fileId: msg.document.file_id,
      fileName: msg.document.file_name,
      mimeType: msg.document.mime_type,
      caption: typeof msg.caption === "string" ? msg.caption : undefined,
    };
    if (input.deps.capture) {
      const isNew = await input.deps.recordIfNew(updateId);
      if (isNew) {
        try {
          await input.deps.capture(ctx, updateId, doc);
        } catch (err) {
          console.warn("[telegram] document capture failed after recordIfNew committed", err);
        }
      }
    } else {
      await tryTouch();
    }
    return { status: 200, body: "ok" };
  }

  // Photo (native photo message) — dedupe + capture, then 200.
  // msg.photo is an array of PhotoSize objects sorted smallest→largest; use the last (largest).
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1]!;
    const doc: DocumentInfo = {
      fileId: largest.file_id,
      fileName: `telegram-photo-${updateId}.jpg`,
      mimeType: "image/jpeg",
      caption: typeof msg.caption === "string" ? msg.caption : undefined,
      isImage: true,
    };
    if (input.deps.capture) {
      const isNew = await input.deps.recordIfNew(updateId);
      if (isNew) {
        try {
          await input.deps.capture(ctx, updateId, doc);
        } catch (err) {
          console.warn("[telegram] photo capture failed after recordIfNew committed", err);
        }
      }
    } else {
      await tryTouch();
    }
    return { status: 200, body: "ok" };
  }

  // Non-text update (sticker, …) — best-effort touch, no dedupe.
  if (typeof msg.text !== "string") {
    await tryTouch();
    return { status: 200, body: "ok" };
  }

  const match = input.deps.match(ctx.text);

  if (!match) {
    // Unknown slash command → silent 200, no touch, no capture (typo).
    if (ctx.text.trim().startsWith("/")) {
      return { status: 200, body: "ok" };
    }

    // Regular text message — best-effort lastSeen touch (always).
    await tryTouch();

    // Deduped capture — only if a capture dep is wired.
    if (input.deps.capture) {
      // C3 applies here too: once we commit recordIfNew we must still return 200.
      const isNew = await input.deps.recordIfNew(updateId);
      if (isNew) {
        try {
          await input.deps.capture(ctx, updateId);
        } catch (err) {
          console.warn("[telegram] capture failed after recordIfNew committed", err);
        }
      }
    }

    return { status: 200, body: "ok" };
  }

  // Known command path — dedupe then dispatch.
  const isNew = await input.deps.recordIfNew(updateId);
  if (!isNew) return { status: 200, body: "ok" };

  // C3: never return non-200 once we've committed the dedupe row. If dispatch
  // throws, retries see the row exists and skip — turning a transient error into
  // a permanent 500 loop. ACK 200 and log instead.
  try {
    await match.command.dispatch(ctx);
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
 * Options:
 *   trackLastSeen — wire non-command messages to touchChatLastSeen (admin UI).
 *   captureInbox  — wire non-command text to the knowledge-inbox capture path.
 */
import type { Scheduler } from "convex/server";

export function buildHandleTelegramWebhook(
  buildRegistrations: (scheduler: Scheduler) => CommandRegistration[],
  options?: { trackLastSeen?: boolean; captureInbox?: boolean },
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
        onNonCommandMessage: options?.trackLastSeen
          ? async (m) => {
              await ctx.runMutation(internal.telegram.chatRegistry.touchChatLastSeen, { chatId: m.chatId });
            }
          : undefined,
        capture: options?.captureInbox
          ? async (m, updateId, document) => {
              // Schedule best-effort — never awaited in-band; a throw here would
              // already be caught by decideWebhookOutcome's try/catch.
              await ctx.scheduler.runAfter(
                0,
                internal.inbox.capture.captureAndAck,
                {
                  chatId: m.chatId,
                  raw: m.text,
                  updateId,
                  fileId: document?.fileId,
                  fileName: document?.fileName,
                  mimeType: document?.mimeType,
                  caption: document?.caption,
                  isImage: document?.isImage,
                },
              );
            }
          : undefined,
      },
    });
    return new Response(outcome.body, { status: outcome.status });
  });
}
