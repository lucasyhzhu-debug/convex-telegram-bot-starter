// convex/telegram/config.ts
//
// THE ONLY FILE YOU ADAPT for self-registration. Everything else in
// convex/telegram/ ships verbatim. Three values:
//
//   1. KNOWN_TELEGRAM_ROLES — your semantic delivery destinations.
//   2. TELEGRAM_ADMIN_URL    — link the bot puts in its /register reply.
//   3. TELEGRAM_BOT_USERNAME — your bot's @username (no @), for help text.
//
// See SELF-REGISTRATION.md for the full mental model.

/**
 * The semantic delivery roles your app routes messages to. A "role" is a stable
 * name (e.g. "pack-list", "sales-updates", "alerts") that a send-action resolves
 * to a concrete Telegram chat at send time via `getChatIdByRole`. This indirection
 * is what lets ops re-point a feed to a different group from the admin UI without
 * a code change or redeploy.
 *
 * Start empty on a greenfield install and add roles as you build feeds. The
 * `as const` makes this a compile-time union — `assignRole` and `getChatIdByRole`
 * are validated against it.
 */
export const KNOWN_TELEGRAM_ROLES = [
  // "pack-list",
  // "sales-updates",
  "brain",   // wiki-brain daily digest destination
] as const;

export type TelegramRole = (typeof KNOWN_TELEGRAM_ROLES)[number];

export function isKnownTelegramRole(s: string): s is TelegramRole {
  return (KNOWN_TELEGRAM_ROLES as readonly string[]).includes(s);
}

/**
 * URL the bot includes in its `/register` reply, pointing the operator at the
 * admin page where they assign a role to the freshly-registered chat. Reads from
 * env so dev/prod can differ; falls back to a placeholder.
 */
export const TELEGRAM_ADMIN_URL =
  process.env.TELEGRAM_ADMIN_URL ?? "http://localhost:5173/admin/telegram-chats";

/**
 * Your bot's @username WITHOUT the leading @ (e.g. "MyOpsBot"). Used in the
 * `/start` help reply and the admin test-send message. Reads from env with a
 * generic fallback so the starter compiles before you've named your bot.
 */
export const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "YourBot";
