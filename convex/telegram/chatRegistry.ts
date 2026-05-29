// convex/telegram/chatRegistry.ts
//
// ── Self-registration registry (v2 headline feature) ─────────────────────────
// Replaces the single TELEGRAM_CHAT_ID env var with a managed routing table.
// An operator adds the bot to a Telegram group and sends `/register@<bot>`; the
// bot writes a `telegramChats` row and replies with a link to the admin UI, where
// the operator assigns the chat a semantic ROLE (from config.ts KNOWN_TELEGRAM_ROLES).
// Send-actions then resolve role → chatId at send time via `getChatIdByRole`, so a
// feed can be re-pointed to a different group with no code change or redeploy.
//
// This file ships VERBATIM across projects — the only seam it touches is
// config.ts (role allowlist + admin URL + bot username). See SELF-REGISTRATION.md.
//
// ── Auth model (starter) ─────────────────────────────────────────────────────
// Management ops come in two flavours, sharing one impl each:
//   • internal*  — internalQuery/internalMutation, callable only from the Convex
//     dashboard or `npx convex run` by an operator. No key. Safe by default.
//   • admin*     — public query/mutation/action gated by a single ADMIN_KEY env
//     var (constant-time compared). These back the bundled React admin app.
// Replace `requireAdminKey` with your real auth (session token, requireRole, …)
// when wiring this into an app that already has users. See SECURITY.md.

import { v, ConvexError } from "convex/values";
import {
  internalQuery,
  internalMutation,
  internalAction,
  query,
  mutation,
  action,
  type QueryCtx,
  type MutationCtx,
  type ActionCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { sendTelegramHtml, escapeHtml } from "../lib/telegramHtml";
import { constantTimeEqual } from "../lib/constantTimeEqual";
import {
  KNOWN_TELEGRAM_ROLES,
  isKnownTelegramRole,
  TELEGRAM_ADMIN_URL,
  TELEGRAM_BOT_USERNAME,
} from "./config";

// ─── auth + role guards ──────────────────────────────────────────────────────

/**
 * Fail-closed admin gate for the public `admin*` functions. Throws if ADMIN_KEY
 * is unset (refuse rather than run wide-open) or if the provided key mismatches.
 * Constant-time compare avoids leaking the key length/prefix via timing.
 */
function requireAdminKey(provided: string): void {
  const expected = process.env.ADMIN_KEY;
  if (!expected) {
    throw new ConvexError(
      "ADMIN_KEY env var is not set — refusing admin calls. Set one with " +
        "`npx convex env set ADMIN_KEY <secret>` (generate via `node scripts/new-webhook-secret.mjs`).",
    );
  }
  if (!constantTimeEqual(provided, expected)) {
    throw new ConvexError("Invalid admin key.");
  }
}

/** Throws ConvexError if `role` is not in KNOWN_TELEGRAM_ROLES (single source of message). */
function assertKnownRole(role: string): void {
  if (!isKnownTelegramRole(role)) {
    throw new ConvexError(
      `Unknown telegram role: '${role}'. Add it to KNOWN_TELEGRAM_ROLES in ` +
        `convex/telegram/config.ts (current: ${KNOWN_TELEGRAM_ROLES.join(", ") || "<empty>"}).`,
    );
  }
}

// ─── parseCommand ────────────────────────────────────────────────────────────

export type RegistryCommand = "register" | "start";

/**
 * Strict-mode parse for the built-in registry commands. Accepts `/register` and
 * `/start` with an optional `@BotName` suffix and surrounding whitespace; rejects
 * trailing args (typo protection). Your own feature commands (e.g. `/pack`) are
 * registered separately via the generic matcher in commands.ts — this only knows
 * the two registry built-ins.
 */
export function parseCommand(text: string): RegistryCommand | null {
  const m = /^\/(register|start)(@[A-Za-z0-9_]+)?$/.exec(text.trim());
  return m ? (m[1] as RegistryCommand) : null;
}

// ─── getChatIdByRole ─────────────────────────────────────────────────────────

/**
 * Three-step lookup chain:
 *   1. Active table row (role match, archivedAt === undefined) → row.chatId
 *   2. Env fallback IF process.env.TELEGRAM_FALLBACK_ROLE === role AND
 *      process.env.TELEGRAM_CHAT_ID is set → that chatId. (Keeps the legacy
 *      single-chat path working during migration; unset it once fully on the
 *      registry, or never set it on a greenfield install.)
 *   3. Throw.
 */
export const getChatIdByRole = internalQuery({
  args: { role: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const row = await ctx.db
      .query("telegramChats")
      .withIndex("by_role_archived", (q) =>
        q.eq("role", args.role).eq("archivedAt", undefined),
      )
      .first();
    if (row) return row.chatId;

    if (
      process.env.TELEGRAM_FALLBACK_ROLE === args.role &&
      process.env.TELEGRAM_CHAT_ID
    ) {
      return process.env.TELEGRAM_CHAT_ID;
    }

    throw new Error(`No Telegram chat assigned to role '${args.role}'`);
  },
});

// ─── touchChatLastSeen ───────────────────────────────────────────────────────

/**
 * UPDATE-only "last seen" stamp, called by the webhook for every non-command
 * message. Pollution prevention: never inserts on an unknown chatId (an unknown
 * chat appearing via a privacy-mode mention is not registration intent — only
 * `/register` registers).
 */
export const touchChatLastSeen = internalMutation({
  args: { chatId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("telegramChats")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    if (!row) return;                          // never seen → ignore
    if (row.archivedAt !== undefined) return;  // archived rows are inert
    await ctx.db.patch(row._id, { lastSeenAt: Date.now() });
  },
});

// ─── registerChat (/register handler) ────────────────────────────────────────

/**
 * Three-state behaviour driven by the existing row:
 *   none    → insert + "Chat registered as <title> …"
 *   dormant → patch lastSeenAt + "Already registered (no role)"
 *   live    → patch lastSeenAt + "Already registered as role <role>"
 * All three HTML-escape the title (parse_mode HTML XSS prevention).
 */
export const registerChat = internalAction({
  args: {
    chatId: v.string(),
    chatType: v.union(
      v.literal("private"),
      v.literal("group"),
      v.literal("supergroup"),
    ),
    title: v.string(),
    registeredBy: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");

    const result = await ctx.runMutation(
      internal.telegram.chatRegistry.upsertChatRow,
      args,
    );

    const safeTitle = escapeHtml(args.title);
    let html: string;
    if (result.status === "inserted") {
      html = `✅ Chat registered as <b>${safeTitle}</b> (${args.chatType}). Assign a role at ${TELEGRAM_ADMIN_URL}`;
    } else if (result.status === "dormant") {
      html = `ℹ️ Already registered (no role assigned yet). Assign at ${TELEGRAM_ADMIN_URL}`;
    } else {
      html = `ℹ️ Already registered as role <b>${escapeHtml(result.role)}</b>. Change at ${TELEGRAM_ADMIN_URL}`;
    }
    await sendTelegramHtml(token, args.chatId, html);
  },
});

/** @internal Atomic read+write backing registerChat's three-state branch. */
export const upsertChatRow = internalMutation({
  args: {
    chatId: v.string(),
    chatType: v.union(
      v.literal("private"),
      v.literal("group"),
      v.literal("supergroup"),
    ),
    title: v.string(),
    registeredBy: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    { status: "inserted" } | { status: "dormant" } | { status: "live"; role: string }
  > => {
    const existing = await ctx.db
      .query("telegramChats")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    const now = Date.now();
    if (!existing) {
      await ctx.db.insert("telegramChats", {
        chatId: args.chatId,
        chatType: args.chatType,
        title: args.title,
        registeredBy: args.registeredBy,
        registeredAt: now,
        lastSeenAt: now,
      });
      return { status: "inserted" };
    }
    await ctx.db.patch(existing._id, { lastSeenAt: now });
    if (existing.role) return { status: "live", role: existing.role };
    return { status: "dormant" };
  },
});

// ─── replyStartHelp (/start handler) ─────────────────────────────────────────

/**
 * Reply to `/start` with a one-line intro pointing at `/register`. `/start` is
 * Telegram's default intro action; unknown commands get a silent 200-ack instead
 * (no noise, no false discovery of unimplemented commands).
 */
export const replyStartHelp = internalAction({
  args: { chatId: v.string() },
  handler: async (_ctx, args): Promise<void> => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
    await sendTelegramHtml(
      token,
      args.chatId,
      `Hi! I'm ${escapeHtml(TELEGRAM_BOT_USERNAME)}. Send /register@${escapeHtml(TELEGRAM_BOT_USERNAME)} to register this chat.`,
    );
  },
});

// ─── management: shared impls (used by both internal* and admin* surfaces) ─────

async function listChatsImpl(
  ctx: QueryCtx,
  includeArchived: boolean,
): Promise<Doc<"telegramChats">[]> {
  // Table is bounded (one row per registered chat, typically < 100), so a full
  // .collect() + in-memory filter is cheap and avoids the archivedAt-undefined
  // index ordering trap.
  const all = await ctx.db.query("telegramChats").collect();
  return includeArchived ? all : all.filter((r) => r.archivedAt === undefined);
}

async function assignRoleImpl(
  ctx: MutationCtx,
  args: {
    chatId: string;
    role: string | null;
    forceReassign?: boolean;
    restoreIfArchived?: boolean;
  },
): Promise<void> {
  if (args.role !== null) assertKnownRole(args.role);

  const target = await ctx.db
    .query("telegramChats")
    .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
    .unique();
  if (!target) {
    throw new ConvexError(`No registered Telegram chat with id '${args.chatId}'`);
  }

  // Clearing a role is allowed even on archived rows (idempotent cleanup).
  if (args.role === null) {
    await ctx.db.patch(target._id, { role: undefined });
    return;
  }

  // Assigning a role to an archived chat is a silent dead-end (getChatIdByRole
  // skips archived rows) UNLESS the caller opts into restoring it atomically.
  const restoringArchived = target.archivedAt !== undefined;
  if (restoringArchived && !args.restoreIfArchived) {
    throw new ConvexError(
      `Cannot assign a role to an archived chat ('${args.chatId}'). Restore it first.`,
    );
  }

  // Enforce role uniqueness: find the current active holder, if any.
  const currentHolder = await ctx.db
    .query("telegramChats")
    .withIndex("by_role_archived", (q) =>
      q.eq("role", args.role!).eq("archivedAt", undefined),
    )
    .first();
  if (currentHolder && currentHolder._id !== target._id) {
    if (!args.forceReassign) {
      throw new ConvexError(
        `Role '${args.role}' already held by chat '${currentHolder.chatId}'. Pass forceReassign: true to override.`,
      );
    }
    await ctx.db.patch(currentHolder._id, { role: undefined });
  }
  // Single atomic write: set role, un-archive if we were asked to restore.
  await ctx.db.patch(target._id, {
    role: args.role,
    ...(restoringArchived ? { archivedAt: undefined } : {}),
  });
}

async function archiveChatImpl(ctx: MutationCtx, chatId: string): Promise<void> {
  const row = await ctx.db
    .query("telegramChats")
    .withIndex("by_chatId", (q) => q.eq("chatId", chatId))
    .unique();
  if (!row) throw new ConvexError(`No registered Telegram chat with id '${chatId}'`);
  // Clear role atomically so an archived row never holds a role-uniqueness slot.
  await ctx.db.patch(row._id, { archivedAt: Date.now(), role: undefined });
}

async function restoreChatImpl(ctx: MutationCtx, chatId: string): Promise<void> {
  const row = await ctx.db
    .query("telegramChats")
    .withIndex("by_chatId", (q) => q.eq("chatId", chatId))
    .unique();
  if (!row) throw new ConvexError(`No registered Telegram chat with id '${chatId}'`);
  await ctx.db.patch(row._id, { archivedAt: undefined });
}

const assignRoleArgs = {
  chatId: v.string(),
  role: v.union(v.string(), v.null()),
  forceReassign: v.optional(v.boolean()),
  restoreIfArchived: v.optional(v.boolean()),
} as const;

// ─── management: internal* surface (Convex dashboard / `npx convex run`) ───────

export const listChats = internalQuery({
  args: { includeArchived: v.boolean() },
  handler: (ctx, args) => listChatsImpl(ctx, args.includeArchived),
});

export const assignRole = internalMutation({
  args: assignRoleArgs,
  handler: (ctx, args) => assignRoleImpl(ctx, args),
});

export const archiveChat = internalMutation({
  args: { chatId: v.string() },
  handler: (ctx, args) => archiveChatImpl(ctx, args.chatId),
});

export const restoreChat = internalMutation({
  args: { chatId: v.string() },
  handler: (ctx, args) => restoreChatImpl(ctx, args.chatId),
});

// ─── management: admin* surface (ADMIN_KEY-gated, backs the React app) ─────────

export const adminListChats = query({
  args: { adminKey: v.string(), includeArchived: v.boolean() },
  handler: (ctx, args) => {
    requireAdminKey(args.adminKey);
    return listChatsImpl(ctx, args.includeArchived);
  },
});

export const adminAssignRole = mutation({
  args: { adminKey: v.string(), ...assignRoleArgs },
  handler: (ctx, { adminKey, ...rest }) => {
    requireAdminKey(adminKey);
    return assignRoleImpl(ctx, rest);
  },
});

export const adminArchiveChat = mutation({
  args: { adminKey: v.string(), chatId: v.string() },
  handler: (ctx, args) => {
    requireAdminKey(args.adminKey);
    return archiveChatImpl(ctx, args.chatId);
  },
});

export const adminRestoreChat = mutation({
  args: { adminKey: v.string(), chatId: v.string() },
  handler: (ctx, args) => {
    requireAdminKey(args.adminKey);
    return restoreChatImpl(ctx, args.chatId);
  },
});

// ─── sendTestMessage (diagnostic test-send from the admin UI) ──────────────────

/** Shared test-send body: sends a wiring-check message and records/clears lastError. */
async function sendTestMessageImpl(ctx: ActionCtx, chatId: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN missing");
  const text = `🧪 Test from ${TELEGRAM_BOT_USERNAME} — wiring works!`;
  try {
    await sendTelegramHtml(botToken, chatId, text);
    await ctx.runMutation(internal.telegram.chatRegistry.clearLastError, { chatId });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw.length > 200 ? raw.slice(0, 199) + "…" : raw;
    await ctx.runMutation(internal.telegram.chatRegistry.recordLastError, { chatId, message });
    throw err;
  }
}

export const sendTestMessage = internalAction({
  args: { chatId: v.string() },
  handler: (ctx, args) => sendTestMessageImpl(ctx, args.chatId),
});

export const adminSendTest = action({
  args: { adminKey: v.string(), chatId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    requireAdminKey(args.adminKey);
    // Existence check mirrors the internal path (clear error message if absent).
    const row = await ctx.runQuery(internal.telegram.chatRegistry.getChatRow, {
      chatId: args.chatId,
    });
    if (!row) throw new ConvexError(`No registered Telegram chat with id '${args.chatId}'`);
    await sendTestMessageImpl(ctx, args.chatId);
  },
});

/** @internal Existence lookup for adminSendTest. */
export const getChatRow = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("telegramChats")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
  },
});

/** @internal Writes lastError; the send action calls this on caught failure. */
export const recordLastError = internalMutation({
  args: { chatId: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("telegramChats")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, { lastError: { at: Date.now(), message: args.message } });
  },
});

/** @internal Clears lastError after a successful send. */
export const clearLastError = internalMutation({
  args: { chatId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("telegramChats")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    if (!row || row.lastError === undefined) return;
    await ctx.db.patch(row._id, { lastError: undefined });
  },
});

// ─── seedChatFromEnv (one-shot migration bootstrap) ───────────────────────────

type SeedResult =
  | { status: "inserted"; chatId: string; title: string; role: string }
  | { status: "graduated-dormant"; chatId: string; title: string; role: string }
  | { status: "already-exists-same-role"; chatId: string; title: string; role: string };

/**
 * One-time bootstrap for migrating off the single TELEGRAM_CHAT_ID env var. Run
 * once from the Convex dashboard (Functions tab) or `npx convex run`. Reads
 * TELEGRAM_CHAT_ID, discovers title+type via Telegram getChat, then INSERT /
 * GRADUATE-dormant / NO-OP / THROW.
 */
export const seedChatFromEnv = internalAction({
  args: { role: v.string() },
  handler: async (ctx, args): Promise<SeedResult> => {
    assertKnownRole(args.role);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN env var missing");
    if (!chatId) throw new Error("TELEGRAM_CHAT_ID env var missing");

    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`,
    );
    const json = (await res.json()) as {
      ok: boolean;
      result?: { type: string; title?: string };
      description?: string;
    };
    if (!res.ok || !json.ok || !json.result) {
      throw new Error(`Telegram getChat failed: ${res.status} ${json.description ?? "unknown"}`);
    }
    const rawType = json.result.type;
    if (rawType !== "private" && rawType !== "group" && rawType !== "supergroup") {
      throw new Error(`Unsupported chat type from Telegram: ${rawType}`);
    }
    const title = json.result.title ?? "(untitled)";

    return await ctx.runMutation(internal.telegram.chatRegistry.seedFromEnvWrite, {
      chatId,
      chatType: rawType,
      title,
      role: args.role,
    });
  },
});

/** @internal The 4-state branch for seedChatFromEnv, in one atomic mutation. */
export const seedFromEnvWrite = internalMutation({
  args: {
    chatId: v.string(),
    chatType: v.union(v.literal("private"), v.literal("group"), v.literal("supergroup")),
    title: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args): Promise<SeedResult> => {
    assertKnownRole(args.role);
    const now = Date.now();
    const existing = await ctx.db
      .query("telegramChats")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();

    if (!existing) {
      await ctx.db.insert("telegramChats", {
        chatId: args.chatId,
        chatType: args.chatType,
        title: args.title,
        role: args.role,
        registeredAt: now,
        lastSeenAt: now,
      });
      return { status: "inserted", chatId: args.chatId, title: args.title, role: args.role };
    }
    if (existing.role === undefined) {
      // Graduate a dormant row; clear archivedAt so a previously-archived chat
      // becomes resolvable (getChatIdByRole skips archived rows).
      await ctx.db.patch(existing._id, { role: args.role, lastSeenAt: now, archivedAt: undefined });
      return { status: "graduated-dormant", chatId: args.chatId, title: existing.title, role: args.role };
    }
    if (existing.role === args.role) {
      return { status: "already-exists-same-role", chatId: args.chatId, title: existing.title, role: args.role };
    }
    throw new ConvexError(
      `Chat ${args.chatId} already registered with role '${existing.role}'. Reassign via the admin UI.`,
    );
  },
});
