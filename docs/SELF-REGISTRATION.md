# SELF-REGISTRATION — multi-chat routing without env edits

This is the headline feature of v2. v1 posted to a single hand-configured group;
v2 lets chats **register themselves** and lets you route any number of feeds to
any number of groups, re-pointable from a UI with no redeploy.

If you just want the architecture diagram, read
[ARCHITECTURE.md](./ARCHITECTURE.md). This doc is the practical walkthrough:
operator flow, developer flow, migration, and recovery.

---

## The mental model

Two nouns and one verb:

- **Chat** — a concrete Telegram group/supergroup/DM. It announces itself to the
  bot by sending `/register@<bot>`. The bot records it in the `telegramChats`
  table.
- **Role** — a stable, human-meaningful name for a *destination* ("pack-list",
  "alerts", "exec-digest"). Roles live in code (`KNOWN_TELEGRAM_ROLES`).
- **Assign** — an operator binds a role to a chat in the admin UI.

Your code never names a chat id. It asks for a **role**, and
`getChatIdByRole({ role })` resolves it at send time. Re-pointing "pack-list"
from the warehouse group to a new group is: register the new group, assign it the
role — done. No code change, no redeploy.

> **The v1 problem this solves:** one `TELEGRAM_CHAT_ID` env var = one
> destination, edited by hand, redeploy to change. Discovering a chat id meant
> `curl …/getUpdates` and reading JSON. Multiple feeds to multiple groups was
> impossible without code surgery.

---

## Operator flow — onboard a new group

No CLI, no `getUpdates`, no env edits.

1. **Add the bot to the group.** Open the Telegram group, add your bot as a
   member (admin rights not required for basic sending).
2. **Send `/register@<bot>` in the group.** Use Telegram's autocomplete so it's a
   real command (privacy mode — see below — means the bot only sees registered
   commands and @mentions).
   The bot replies:
   > ✅ Chat registered as **Warehouse Ops** (supergroup). Assign a role at
   > http://localhost:5173/admin/telegram-chats
3. **Open the admin UI** at the link the bot gave you
   (`/admin/telegram-chats`). The freshly-registered chat appears in the list as
   *dormant* (registered, no role).
4. **Assign a role** from the dropdown (its options are your
   `KNOWN_TELEGRAM_ROLES`). The chat is now *active* and feeds for that role
   route to it.
5. **(Optional) Test-send** from the admin UI to confirm wiring before the next
   scheduled post.

That's it. The next cron or slash command for that role lands in the new group.

### CLI equivalents (skip the UI)

Every admin action has an `internal*` twin callable from `npx convex run` (no
`ADMIN_KEY` needed — internal functions aren't publicly reachable):

```bash
# List registered chats (set true to include archived)
npx convex run telegram/chatRegistry:listChats '{"includeArchived":false}'

# Assign a role to a chat (chatId is a STRING — keep the -100… prefix)
npx convex run telegram/chatRegistry:assignRole '{"chatId":"-100...","role":"alerts"}'

# Move a role to a different chat that already holds another role
npx convex run telegram/chatRegistry:assignRole '{"chatId":"-100...","role":"alerts","forceReassign":true}'

# Clear a role (chat stays registered, becomes dormant)
npx convex run telegram/chatRegistry:assignRole '{"chatId":"-100...","role":null}'

# Archive (soft-delete; clears the role slot) / restore
npx convex run telegram/chatRegistry:archiveChat '{"chatId":"-100..."}'
npx convex run telegram/chatRegistry:restoreChat '{"chatId":"-100..."}'

# Diagnostic test-send to a chat
npx convex run telegram/chatRegistry:sendTestMessage '{"chatId":"-100..."}'
```

Add `--prod` to target the production deployment.

---

## Developer flow — add a new feed

Adding a delivery destination is three steps and **no new env var**:

1. **Add the role to `convex/telegram/config.ts`:**
   ```ts
   export const KNOWN_TELEGRAM_ROLES = [
     "pack-list",
     "alerts",          // ← new
   ] as const;
   ```
   The `as const` makes this a compile-time union, so `assignRole` and
   `getChatIdByRole` are type-checked against it.

2. **Write a send-action that resolves the role at send time:**
   ```ts
   // convex/alerts/sendAlerts.ts
   import { internalAction } from "../_generated/server";
   import { internal } from "../_generated/api";
   import { sendTelegramHtml } from "../lib/telegramHtml";

   export const sendAlerts = internalAction({
     args: { /* ... */ },
     handler: async (ctx, args): Promise<void> => {
       const token = process.env.TELEGRAM_BOT_TOKEN;
       if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
       const chatId = await ctx.runQuery(
         internal.telegram.chatRegistry.getChatIdByRole,
         { role: "alerts" },
       );
       await sendTelegramHtml(token, chatId, "<b>Alert</b> …");
     },
   });
   ```
   That's the only difference from a v1 send-action: read `chatId` from
   `getChatIdByRole`, not `process.env.TELEGRAM_CHAT_ID`.

3. **Register the group + assign the role** (operator flow above). Done.

> If the feed is **cron-triggered**, also wrap it in a `*Resilient` action — see
> [ARCHITECTURE.md](./ARCHITECTURE.md) § "Cron resilience" and the worked example
> in `convex/examples/packList/`. The on-demand path keeps calling the raw action.

> **Adding a 3rd+ flow — extend the role list, never hardcode an env var.** The
> whole point of the registry is that the chatId lookup needs no new env var and
> no code change beyond the role string + the send-action.

---

## The lookup chain

`getChatIdByRole({ role })` resolves in three steps:

| # | Step | Condition | Result |
|---|------|-----------|--------|
| 1 | **Active table row** | a `telegramChats` row with `role === role` and `archivedAt === undefined` | `row.chatId` |
| 2 | **Env fallback** | `TELEGRAM_FALLBACK_ROLE === role` **and** `TELEGRAM_CHAT_ID` is set | that env chat id |
| 3 | **Throw** | neither matches | `Error("No Telegram chat assigned to role '<role>'")` |

Step 1 is the normal path. Step 2 is the migration shim (next section). Step 3 is
a loud failure — a missing assignment surfaces as a thrown error in the Convex
logs / cron dashboard, not a silent drop.

---

## Migration — from a single `TELEGRAM_CHAT_ID`

If you're upgrading a working v1 bot, you don't have to cut over in one shot. Two
mechanisms let the old feed keep running while you move it onto the registry.

### Path A — the env fallback shim (zero-downtime)

1. Set the fallback so the legacy env var still answers for one role:
   ```bash
   npx convex env set TELEGRAM_FALLBACK_ROLE=pack-list   # the role you're migrating
   # TELEGRAM_CHAT_ID stays set (your existing v1 value)
   ```
   Now `getChatIdByRole({ role: "pack-list" })` returns `TELEGRAM_CHAT_ID` via
   step 2 of the lookup chain even before any row is assigned. The feed keeps
   working the instant you switch the send-action over to `getChatIdByRole`.
2. Register the group properly (`/register@<bot>`) and assign it the role in the
   admin UI. Now step 1 wins and the row is the source of truth.
3. Remove the shim once fully migrated:
   ```bash
   npx convex env unset TELEGRAM_FALLBACK_ROLE
   # optionally unset TELEGRAM_CHAT_ID if nothing else reads it
   ```

### Path B — `seedChatFromEnv` (one-shot bootstrap)

`seedChatFromEnv` reads your existing `TELEGRAM_CHAT_ID`, fetches the chat's
title + type from Telegram (`getChat`), and writes a fully-formed `telegramChats`
row with the role pre-assigned — so you skip the manual `/register` step for the
chat you already have:

```bash
npx convex run telegram/chatRegistry:seedChatFromEnv '{"role":"pack-list"}'
```

It's idempotent across four outcomes:

| Existing row | Result |
|--------------|--------|
| none | **inserted** with the role assigned |
| dormant (no role) | **graduated** — role assigned, un-archived if needed |
| same role already | **no-op** |
| a *different* role | **throws** — reassign in the admin UI instead |

Run it once, from the Convex dashboard Functions tab or `npx convex run`. It's a
bootstrap, not part of the normal flow.

> **Greenfield install?** Skip migration entirely. Leave `TELEGRAM_FALLBACK_ROLE`
> and `TELEGRAM_CHAT_ID` unset, register your groups, and assign roles.

---

## When to use the registry vs the simple env path

| Use the **simple env path** (v1) | Use the **registry** (v2) |
|---|---|
| Exactly one destination group, ever | 2+ semantic destinations (pack-list + alerts + …) |
| You're fine editing an env var + redeploying to repoint | You want to repoint a feed from a UI, no deploy |
| No need for self-service group onboarding | Ops should onboard groups themselves (no `getUpdates`) |
| Minimal surface, no admin app | You want the admin UI + last-seen / test-send / archive |

The two coexist: the registry's env-fallback step means a v1-style single-chat
setup keeps working unchanged while you decide.

---

## Group → supergroup migration recovery

When a Telegram group crosses the member threshold (or you enable certain
features), Telegram silently migrates it to a **supergroup** and the chat id
changes from `-NNN` to `-100NNN`. The old id becomes inert. The registry does
**not** auto-handle `migrate_to_chat_id` updates (deferred), so recover by hand:

1. In `/admin/telegram-chats`, **archive** the old chat's row (this frees its
   role slot).
2. The bot is usually carried into the new supergroup automatically (members are
   inherited). If not, add it.
3. Send `/register@<bot>` in the new supergroup — it registers with the new
   `-100…` id.
4. **Assign the same role** to the new row. The feed resumes on the next send.

CLI version:

```bash
npx convex run telegram/chatRegistry:archiveChat '{"chatId":"-987654321"}'         # old id
# (send /register@<bot> in the supergroup)
npx convex run telegram/chatRegistry:assignRole '{"chatId":"-100987654321","role":"pack-list"}'  # new id
```

See [RUNBOOK.md](../RUNBOOK.md) § "Chat vanished after group upgraded to
supergroup".

---

## Privacy mode reminder

BotFather sets **privacy mode ON** by default. In privacy mode the bot only sees
messages that mention it (`@bot`) or are commands registered via
BotFather `/setcommands`. So:

- Add `register` and `start` to your `/setcommands` list, or operators' `/register`
  won't reach the bot in a group.
- Ensure your webhook's `allowed_updates` includes `"message"` (the bundled
  `scripts/register-webhook.mjs` does this) — otherwise the `/register` text
  update is filtered out before it reaches the webhook.

See [RUNBOOK.md](../RUNBOOK.md) § "/register did nothing".
