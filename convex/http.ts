// convex/http.ts
//
// Telegram webhook + outbound HTTP endpoints for LucasKnowledgeBot.
//
// Routes:
//   POST /telegram-webhook   — inbound Telegram updates (webhook)
//   POST /post-message       — outbound send; called by wiki-brain Claude Code plugin
//
// Note: helloWorld and packList example command registrations are intentionally
// omitted — this is a knowledge bot, not the FMCG demo. The example files are
// kept on disk for reference.

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildHandleTelegramWebhook } from "./telegram/webhook";
import { buildRegistryCommands } from "./telegram/registryCommands";
import { buildThreadCommands } from "./telegram/threadCommands";
import { constantTimeEqual } from "./lib/constantTimeEqual";
import { sendTelegramHtml } from "./lib/telegramHtml";

const http = httpRouter();

// ── Telegram webhook ──────────────────────────────────────────────────────────

http.route({
  path: "/telegram-webhook",
  method: "POST",
  handler: buildHandleTelegramWebhook(
    (scheduler) => [
      ...buildRegistryCommands(scheduler),
      ...buildThreadCommands(scheduler),
    ],
    { trackLastSeen: true, captureInbox: true },
  ),
});

// ── POST /post-message ────────────────────────────────────────────────────────
//
// Secret-protected outbound send. Used by wiki-brain to deliver per-source
// summaries (to originating chatId) and the daily digest (to role "brain").
//
// Request body (JSON):
//   { html: string, chatId?: string, role?: string }
//
// Destination resolution (first match wins):
//   1. chatId — use directly
//   2. role   — resolve via getChatIdByRole
// Exactly one of chatId or role must be provided.

http.route({
  path: "/post-message",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // ── Auth (constant-time, identical pattern to webhook) ──────────────────
    const providedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expectedSecret || !providedSecret) {
      return new Response("unauthorized", { status: 401 });
    }
    if (!constantTimeEqual(providedSecret, expectedSecret)) {
      return new Response("unauthorized", { status: 401 });
    }

    // ── Parse body ──────────────────────────────────────────────────────────
    let body: { html?: unknown; chatId?: unknown; role?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return new Response("bad request: invalid JSON", { status: 400 });
    }

    const html = body.html;
    if (typeof html !== "string" || html.trim() === "") {
      return new Response("bad request: html is required", { status: 400 });
    }

    const hasChatId = typeof body.chatId === "string" && (body.chatId as string).trim() !== "";
    const hasRole = typeof body.role === "string" && (body.role as string).trim() !== "";

    if (!hasChatId && !hasRole) {
      return new Response("bad request: provide chatId or role", { status: 400 });
    }

    // ── Resolve destination ─────────────────────────────────────────────────
    let destChatId: string;
    if (hasChatId) {
      destChatId = (body.chatId as string).trim();
    } else {
      try {
        destChatId = await ctx.runQuery(
          internal.telegram.chatRegistry.getChatIdByRole,
          { role: (body.role as string).trim() },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(`not found: ${msg}`, { status: 404 });
      }
    }

    // ── Send via sendTelegramHtml (chunked) ─────────────────────────────────
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return new Response("server error: TELEGRAM_BOT_TOKEN missing", { status: 500 });
    }

    try {
      await sendTelegramHtml(token, destChatId, html);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`send failed: ${msg}`, { status: 502 });
    }

    // Log outbound message — best-effort, never blocks the response
    try {
      await ctx.runMutation(internal.messages.logMessage, {
        chatId: destChatId,
        direction: "out",
        text: html,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.warn("[http] logMessage (out) failed (non-fatal)", err);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
