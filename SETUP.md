# SETUP — from 0 to working bot in ~15 minutes

This walks you from "fresh clone" to "/ping returns a reply in my Telegram group." Estimated time: 15 minutes plus a 24h wait if Telegram throttles your first `/setcommands` (uncommon).

> When a step fails, jump to `RUNBOOK.md` — every common failure mode is catalogued there.

---

## 1. Create your bot with BotFather

In Telegram, open a chat with `@BotFather`, send `/newbot`.

- Choose a display name (e.g. `My Pack List Bot`)
- Choose a unique username ending in `bot` (e.g. `my_packlist_bot`)
- BotFather replies with a token like `8390266374:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`. **Save it.** Don't share it.

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
- Supergroup: `-1001234567890` (starts with `-100`)

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

You're done. Next: read `convex/examples/packList/README.md` for the real-world reference, or `LESSONS.md` for why those weird patterns.
