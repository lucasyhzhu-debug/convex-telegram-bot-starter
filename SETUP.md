# SETUP — from 0 to working bot in ~15 minutes

This walks you from "fresh clone" to "/ping returns a reply in my Telegram group." Estimated time: 15 minutes plus a 24h wait if Telegram throttles your first `/setcommands` (uncommon).

> When a step fails, jump to `RUNBOOK.md` — every common failure mode is catalogued there.

---

## 1. Create your bot with BotFather

In Telegram, open a chat with `@BotFather`, send `/newbot`.

- Choose a display name (e.g. `My Pack List Bot`)
- Choose a unique username ending in `bot` (e.g. `my_packlist_bot`)
- BotFather replies with a token like `<botid>:<token-string>` (looks like `1234567890:AAExxxxxxxx…`). **Save it.** Don't share it.

Also note: BotFather sets **privacy mode ON by default** for new bots. Privacy mode means your bot only sees messages that mention it (`@your_bot`) or are commands registered via `/setcommands` (see step 7).

**RUNBOOK:** see "401 from getMe" if you suspect the token is bad.

## 2. Generate a webhook secret

```bash
node scripts/new-webhook-secret.mjs
```
Output: 64 hex chars. **Save it.** This is the shared secret Telegram includes on every callback so we know it's really them.

## 3. Create the Convex dev deployment

If you haven't already:
```bash
npx convex dev --once --configure new
```
Pick a project name (e.g. `your-bot-name-dev`). Convex writes `CONVEX_DEPLOYMENT` + `CONVEX_URL` to `.env.local` (gitignored).

## 4. Set the bot env vars on the DEV deployment

```bash
npx convex env set TELEGRAM_BOT_TOKEN=<your-bot-token>
npx convex env set TELEGRAM_WEBHOOK_SECRET=<your-64-hex-secret>
# TELEGRAM_CHAT_ID set in step 5
```

**Gotcha:** negative chat IDs (groups + supergroups) need the `key=value` form, not `key value` (space-separated). The CLI's positional arg parser interprets leading `-` as a flag. Always: `npx convex env set X=Y`.

## 5. Discover your chat_id

Create the Telegram group → add your bot → @ mention the bot once so it sees the chat → fetch updates:

```bash
curl "https://api.telegram.org/bot<your-bot-token>/getUpdates"
```

Look in the response JSON for `"chat": {"id": ...}`. Examples:
- Private chat with the bot: `123456789` (positive)
- Group: `-987654321` (negative)
- Supergroup: `-100<digits>` (starts with `-100`)

Then:
```bash
npx convex env set TELEGRAM_CHAT_ID=<the-id-with-negatives-preserved>
```

**Supergroup heads-up:** if you upgrade your regular group to a supergroup later, the chat_id changes from `-NNN` to `-100NNN`. You'll need to repeat this step with the new ID. See RUNBOOK #11.

## 6. Register the webhook

```bash
node scripts/register-webhook.mjs \
  --token=<your-bot-token> \
  --deployment=<your-convex-deployment-name> \
  --secret=<your-64-hex-secret>
```

(The deployment name is the part before `.convex.cloud` in your `CONVEX_URL`, e.g. `acrobatic-heron-931`.)

The script POSTs to Telegram's `setWebhook` endpoint with a JSON body constructed in Node — this sidesteps a PowerShell quirk where `curl -d 'allowed_updates=["message"]'` splits on `[`. See RUNBOOK #5.

Expected output:
```json
{ "ok": true, "result": true, "description": "Webhook was set" }
```

## 7. Run `/setcommands` so commands autocomplete in groups

BotFather → `/setcommands` → pick your bot → paste:
```
ping - say hello (hello-world example)
pack - post the pack list now (pack-list example, if enabled)
```

This is **required** for group chats with privacy mode ON — without it, the bot won't see `/ping` or `/pack` even though they're typed in the group. See RUNBOOK #2.

## 8. Smoke-test the hello-world action

```bash
npx convex run examples/helloWorld/sendHello:sendHello '{"reason":"command"}'
```

Within ~2s, your group should receive: "👋 On-demand Hello — Bot is alive — <UTC datetime>".

If you see it: success. If not: RUNBOOK #1 (webhook health) or #3 (env-var deployment scope).

Then send `/ping` in the group. Same message.

## 9. Production cutover (when you're ready)

Two paths:

**A) Separate bot for prod.** Recommended. Create a second bot via BotFather, generate a separate webhook secret, set env vars on prod (`npx convex env set X=Y --prod`), register the webhook against the prod deployment. Clean separation.

**B) Same bot for both dev and prod.** Risky — both deployments share the bot token, both can listen to webhooks, both can fire crons. To avoid duplicate sends, you MUST unset the bot env vars on dev when sharing one bot:
```bash
npx convex env unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
```
Otherwise crons fire on both deployments at once.

See RUNBOOK #10.

## 10. Enable the cron jobs you want

`convex/crons.ts` ships with all three entries **commented out** so a fresh clone deploying to prod doesn't spam your group on day 1. To enable:

1. Open `convex/crons.ts`
2. Uncomment the `import { internal }` line
3. Uncomment the cron entry block(s) you want (hello-world daily, pack-list morning, pack-list midday)
4. Commit:
   ```bash
   git add convex/crons.ts
   git commit -m "ops: enable hello-world daily cron"
   ```
5. Deploy:
   ```bash
   npx convex deploy --prod
   ```
6. Verify the cron registered:
   ```bash
   npx convex dashboard --prod
   ```
   → Schedules tab. You should see your cron with its next-fire timestamp.

## 11. Verify webhook health

```bash
curl "https://api.telegram.org/bot<your-bot-token>/getWebhookInfo"
```

Healthy response:
- `pending_update_count: 0` (or 1–2 transiently)
- `last_error_message` unset (no field) or empty

If `pending_update_count` keeps climbing, see RUNBOOK #1.

## 12. (Optional) Enable the pre-commit secret guard

`package.json`'s `"prepare": "husky"` runs on `npm install` but the active hook file is opt-in:

```bash
npx husky init                                  # creates .husky/_/ and a default .husky/pre-commit
cp .husky/pre-commit.sample .husky/pre-commit   # replace the default with our verify-no-secrets + type-check hook
# Windows: no chmod needed (Windows honors file existence, not the exec bit)
# macOS/Linux: chmod +x .husky/pre-commit
```

Test it:
```bash
git add . && git commit -m "test"
```
Should run `verify-no-secrets --staged` and `npm run type-check` before the commit lands.

---

You're done with the single-chat path. Next: read
`convex/examples/packList/README.md` for the real-world reference, `LESSONS.md`
for why those weird patterns, or **Part 2** below to enable self-registration and
route to multiple groups.

---

# Part 2 — Self-registration & multi-chat routing (v2)

Part 1 got you posting to ONE group via `TELEGRAM_CHAT_ID`. Part 2 turns on the
v2 registry: chats register themselves with `/register@<bot>`, you assign each a
semantic **role**, and send-actions route by role — repointable from a UI with no
redeploy. Read [docs/SELF-REGISTRATION.md](docs/SELF-REGISTRATION.md) for the full
mental model; this section is the wiring.

The webhook is **already wired** for the registry in `convex/http.ts`
(`buildRegistryCommands` is concatenated in, and `{ trackLastSeen: true }` is
set). You just need env vars, roles, and the admin app.

## 2.1 Set the v2 env vars

```bash
# ADMIN_KEY gates the public admin* functions that back the React admin app.
# Generate one the same way as the webhook secret:
node scripts/new-webhook-secret.mjs
npx convex env set ADMIN_KEY=<the-64-hex-secret>

# Your bot's @username WITHOUT the @ (used in /start + test-send text):
npx convex env set TELEGRAM_BOT_USERNAME=<YourBotUsername>

# URL the bot puts in its /register reply, linking to the admin UI.
# Local dev default is http://localhost:5173/admin/telegram-chats — set this on
# prod to your deployed admin URL:
npx convex env set TELEGRAM_ADMIN_URL=https://your-admin-host/admin/telegram-chats
```

Add `--prod` to set these on the production deployment too.

> **Migrating an existing v1 bot?** Also set `TELEGRAM_FALLBACK_ROLE=<role>` so
> the legacy `TELEGRAM_CHAT_ID` keeps answering for that one role during cutover.
> See [docs/SELF-REGISTRATION.md](docs/SELF-REGISTRATION.md) § "Migration".

## 2.2 Declare your roles

Open `convex/telegram/config.ts` and add your semantic delivery destinations to
`KNOWN_TELEGRAM_ROLES` (it ships empty):

```ts
export const KNOWN_TELEGRAM_ROLES = [
  "pack-list",
  "alerts",
] as const;
```

The `as const` makes this a compile-time union, type-checked everywhere a role is
used. Deploy so the backend knows the new roles:

```bash
npx convex deploy        # or rely on `npx convex dev` if running
```

## 2.3 Run the React admin app

The admin app lives under `src/` and ships in this repo — `npm install` (Part 1
step) already pulled its deps.

```bash
# Vite reads the deployment URL at build time (note the VITE_ prefix).
# Get the URL from `npx convex dev` output or the dashboard:
echo "VITE_CONVEX_URL=https://<your-deployment>.convex.cloud" >> .env.local

npm run dev:web          # starts Vite on http://localhost:5173
```

Open `http://localhost:5173/admin/telegram-chats`. On first load it asks for the
`ADMIN_KEY` you set in 2.1 — it's stored in `localStorage` and sent with every
admin call. (For production, `npm run build:web` and serve the `dist/` output;
set `TELEGRAM_ADMIN_URL` to wherever you host it.)

## 2.4 Register a group & assign a role

1. Make sure `register` and `start` are in your BotFather `/setcommands` list
   (re-run SETUP step 7 with these lines added), or privacy mode swallows
   `/register` in groups:
   ```
   register - register this chat for routing
   start - what this bot does
   ```
2. Add the bot to the target Telegram group.
3. In the group, send `/register@<bot>`. The bot replies:
   > ✅ Chat registered as **<group title>** (supergroup). Assign a role at
   > <your TELEGRAM_ADMIN_URL>
4. In `/admin/telegram-chats`, the chat appears as *dormant*. Pick a role from
   the dropdown to make it *active*.
5. Click **Test send** to confirm wiring before the next scheduled post.

### CLI equivalents (operators who skip the UI)

Every admin action has an `internal*` twin callable from `npx convex run` — no
`ADMIN_KEY` needed:

```bash
npx convex run telegram/chatRegistry:listChats '{"includeArchived":false}'
npx convex run telegram/chatRegistry:assignRole '{"chatId":"-100...","role":"alerts"}'
npx convex run telegram/chatRegistry:assignRole '{"chatId":"-100...","role":null}'   # clear
npx convex run telegram/chatRegistry:archiveChat '{"chatId":"-100..."}'
npx convex run telegram/chatRegistry:restoreChat '{"chatId":"-100..."}'
npx convex run telegram/chatRegistry:sendTestMessage '{"chatId":"-100..."}'
```

`chatId` is always a **string** (keep the `-100…` prefix). Add `--prod` for the
production deployment.

## 2.5 Point a feed at a role

In your send-action, resolve the chat id by role instead of reading the env var:

```ts
const chatId = await ctx.runQuery(
  internal.telegram.chatRegistry.getChatIdByRole,
  { role: "alerts" },
);
await sendTelegramHtml(token, chatId, html);
```

That's the only change from a v1 send-action. To add a brand-new feed: add the
role to `KNOWN_TELEGRAM_ROLES`, write the send-action against `getChatIdByRole`,
register the group + assign the role — **no new env var**. If the feed is
cron-triggered, wrap it in a `*Resilient` action (see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) § "Cron resilience").
