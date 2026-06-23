// convex/inbox/capture.ts
//
// Inbound capture path: parse a non-command text message, classify intent,
// dedupe it, enqueue it to the inbox, and schedule an immediate ack reply.
//
// Pure logic (parseCapture, classifyIntent, detectKind) is exported for unit
// tests. The internalAction (captureAndAck) is what the webhook schedules —
// it reads env vars, runs the mutation, and schedules the Telegram reply.
// All failures are best-effort: the caller (webhook) has already committed
// the 200 ACK via recordIfNew.

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { sendTelegramHtml } from "../lib/telegramHtml";

// ─── Pure parsing helpers (exported for tests) ────────────────────────────────

export type InboxKind = "url" | "text" | "youtube";
export type InboxIntent = "save" | "ask" | "command" | "other";

/** Detect kind from source string. YouTube wins over generic url. */
export function detectKind(source: string): InboxKind {
  if (/youtu\.?be(\.com)?/i.test(source)) return "youtube";
  if (/^https?:\/\//i.test(source)) return "url";
  return "text";
}

export interface ParseResult {
  category: string;
  source: string;
  kind: InboxKind;
  intent: InboxIntent;
  op: "save" | "ask";
}

/**
 * Parse a raw message text into a capture result.
 *
 * Category extraction (first match wins):
 *   1. Leading "under <category>" prefix (case-insensitive):
 *      "under recipes https://…"  → category="recipes", source="https://…"
 *   2. Leading #hashtag:
 *      "#recipes https://…"       → category="recipes", source="https://…"
 *   3. Trailing #hashtag:
 *      "https://… #recipes"       → category="recipes", source="https://…"
 *   4. Default: "inbox"
 *
 * The directive is always stripped from source.
 *
 * Intent/op are derived from the same content signals but do NOT override
 * the category field — use classifyIntent() when you need the ask-routing
 * that sets category="ask" for plain prose.
 *
 * Exported for unit testing — no Convex runtime dependency.
 */
export function parseCapture(raw: string): ParseResult {
  let text = raw.trim();
  let category = "inbox";

  // 1. Leading "under <category>"
  const underMatch = /^under\s+(\S+)\s+([\s\S]+)$/i.exec(text);
  if (underMatch) {
    category = underMatch[1]!.toLowerCase();
    text = underMatch[2]!.trim();
    return { category, source: text, kind: detectKind(text), intent: "save", op: "save" };
  }

  // 2. Leading #hashtag
  const leadingHashMatch = /^#(\w+)\s+([\s\S]+)$/i.exec(text);
  if (leadingHashMatch) {
    category = leadingHashMatch[1]!.toLowerCase();
    text = leadingHashMatch[2]!.trim();
    return { category, source: text, kind: detectKind(text), intent: "save", op: "save" };
  }

  // 3. Trailing #hashtag
  const trailingHashMatch = /^([\s\S]+?)\s+#(\w+)$/i.exec(text);
  if (trailingHashMatch) {
    text = trailingHashMatch[1]!.trim();
    category = trailingHashMatch[2]!.toLowerCase();
    return { category, source: text, kind: detectKind(text), intent: "save", op: "save" };
  }

  // 4. URL in text → save
  if (/https?:\/\//i.test(text)) {
    return { category, source: text, kind: detectKind(text), intent: "save", op: "save" };
  }

  // 5. Plain text → treat as ask (but keep category "inbox" for backward compat)
  return { category, source: text, kind: detectKind(text), intent: "ask", op: "ask" };
}

/**
 * Classify intent from a raw message, with save:/ask: prefix support and
 * full ask-routing (category="ask" for plain prose and ask: prefix).
 *
 * This is what captureAndAck calls. classifyIntent differs from parseCapture
 * in one key way: for op="ask" results, category is "ask" (not "inbox").
 *
 * Op/intent resolution order:
 *   1. Leading "save:" prefix (case-insensitive) → intent "save", op "save"
 *   2. Leading "ask:" prefix (case-insensitive)  → intent "ask", op "ask", category "ask"
 *   3. Post-strip source contains http(s) URL    → intent "save", op "save"
 *   4. Post-strip has "under <cat>" or #hashtag directive → intent "save", op "save"
 *   5. Plain prose/question → intent "ask", op "ask", category "ask"
 *
 * Exported for unit testing — no Convex runtime dependency.
 */
export function classifyIntent(raw: string): ParseResult {
  let text = raw.trim();

  // Strip "save:" or "ask:" prefix (case-insensitive, optional trailing space)
  const saveMatch = /^save:\s*/i.exec(text);
  const askMatch = /^ask:\s*/i.exec(text);

  if (saveMatch) {
    text = text.slice(saveMatch[0].length).trim();
    // Parse the remaining text for category/kind/source
    const inner = _extractSaveContent(text);
    return { ...inner, intent: "save", op: "save" };
  }

  if (askMatch) {
    text = text.slice(askMatch[0].length).trim();
    return { category: "ask", source: text, kind: "text", intent: "ask", op: "ask" };
  }

  // No explicit prefix — infer from content

  // Check for URL
  if (/https?:\/\//i.test(text)) {
    const inner = _extractSaveContent(text);
    return { ...inner, intent: "save", op: "save" };
  }

  // Check for "under <cat>" directive
  if (/^under\s+\S+\s+/i.test(text)) {
    const inner = _extractSaveContent(text);
    return { ...inner, intent: "save", op: "save" };
  }

  // Check for leading or trailing #hashtag
  if (/^#\w+\s+/i.test(text) || /\s+#\w+$/i.test(text)) {
    const inner = _extractSaveContent(text);
    return { ...inner, intent: "save", op: "save" };
  }

  // Plain prose / question → ask, with category "ask"
  return { category: "ask", source: text, kind: "text", intent: "ask", op: "ask" };
}

/**
 * Extract category/source/kind from a (potentially directive-prefixed) text.
 * Internal helper — implements the category extraction logic.
 * Default category is "inbox" when no directive is present.
 */
function _extractSaveContent(text: string): { category: string; source: string; kind: InboxKind } {
  let category = "inbox";

  // 1. Leading "under <category>"
  const underMatch = /^under\s+(\S+)\s+([\s\S]+)$/i.exec(text);
  if (underMatch) {
    category = underMatch[1]!.toLowerCase();
    const src = underMatch[2]!.trim();
    return { category, source: src, kind: detectKind(src) };
  }

  // 2. Leading #hashtag
  const leadingHashMatch = /^#(\w+)\s+([\s\S]+)$/i.exec(text);
  if (leadingHashMatch) {
    category = leadingHashMatch[1]!.toLowerCase();
    const src = leadingHashMatch[2]!.trim();
    return { category, source: src, kind: detectKind(src) };
  }

  // 3. Trailing #hashtag
  const trailingHashMatch = /^([\s\S]+?)\s+#(\w+)$/i.exec(text);
  if (trailingHashMatch) {
    const src = trailingHashMatch[1]!.trim();
    category = trailingHashMatch[2]!.toLowerCase();
    return { category, source: src, kind: detectKind(src) };
  }

  return { category, source: text, kind: detectKind(text) };
}

// ─── internalAction: captureAndAck ────────────────────────────────────────────

/**
 * Scheduled by the webhook (runAfter(0, …)) after recordIfNew succeeds for a
 * non-command text message. Resolves/creates the active thread, logs the inbound
 * message, inserts the inbox row, sends the ack reply, and logs the outbound ack.
 *
 * Failures here are logged but never surfaced to Telegram as errors — the
 * 200 ACK was already committed at the HTTP layer. Telegram will NOT retry.
 */
export const captureAndAck = internalAction({
  args: {
    chatId: v.string(),
    raw: v.string(),
    updateId: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.warn("[inbox] captureAndAck: TELEGRAM_BOT_TOKEN missing — skipping");
      return;
    }

    const parsed = classifyIntent(args.raw);
    const now = Date.now();

    // Resolve active thread
    let threadId: string | undefined;
    try {
      threadId = await ctx.runMutation(internal.messages.resolveThread, {
        chatId: args.chatId,
        now,
      });
    } catch (err) {
      console.warn("[inbox] resolveThread failed (non-fatal)", err);
    }

    // Log inbound message
    try {
      await ctx.runMutation(internal.messages.logMessage, {
        chatId: args.chatId,
        direction: "in",
        text: args.raw,
        intent: parsed.intent,
        op: parsed.op,
        threadId: threadId as any,
        updateId: args.updateId,
        createdAt: now,
      });
    } catch (err) {
      console.warn("[inbox] logMessage (in) failed (non-fatal)", err);
    }

    // Insert inbox row
    await ctx.runMutation(internal.inbox.enqueue, {
      category: parsed.category,
      source: parsed.source,
      kind: parsed.kind,
      chatId: args.chatId,
      raw: args.raw,
      op: parsed.op,
    });

    // Choose ack text based on op
    const ackText =
      parsed.op === "save"
        ? "Yep — saving this. I'll send a quick summary once it's filed."
        : "🔎 Looking that up in your wiki — one moment…";

    // Ack reply — best-effort; never throws up
    try {
      await sendTelegramHtml(token, args.chatId, ackText);
    } catch (err) {
      console.warn("[inbox] ack reply failed (non-fatal)", err);
      return;
    }

    // Log outbound ack
    try {
      await ctx.runMutation(internal.messages.logMessage, {
        chatId: args.chatId,
        direction: "out",
        text: ackText,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.warn("[inbox] logMessage (out) failed (non-fatal)", err);
    }
  },
});
