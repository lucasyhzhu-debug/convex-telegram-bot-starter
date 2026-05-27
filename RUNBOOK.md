# RUNBOOK — what to do when X breaks

Each entry: symptom → likely cause → diagnostic command → fix.

---

## 1. Webhook is silently dropping updates

**Symptom:** `pending_update_count` in `getWebhookInfo` keeps climbing. The bot doesn't reply to `/ping` even though SETUP smoke-tested fine.

**Diagnosis:**
```bash
curl "https://api.telegram.org/bot<your-token>/getWebhookInfo"
```
Look at `last_error_message`. Common values:
- `"Wrong response from the webhook: ..."`  → the convex http endpoint is returning non-200. Check Convex logs (`npx convex logs`).
- `"SSL error ..."` → the URL is wrong, doesn't resolve.

**Fix:** if `last_error_message` is set, the URL is bad or the endpoint is broken. Re-run `node scripts/register-webhook.mjs ...` to re-register. If Convex logs show a 500, that's a bug in `decideWebhookOutcome` — file an issue.

---

## 2. `/ping` doesn't autocomplete in the Telegram group

**Symptom:** Type `/` in the group and the bot's commands don't show up.

**Cause:** BotFather privacy mode is ON (default) for the bot. The bot doesn't see messages in groups unless they mention it OR they're commands registered via `/setcommands`.

**Fix:** BotFather → `/setcommands` → pick your bot → paste the command list (see SETUP step 7). Wait ~30 seconds — Telegram caches the list.

---

## 3. Cron throws "Telegram env vars missing"

**Symptom:** Convex Dashboard's Schedules tab shows the cron firing, but the function throws.

**Cause:** Wrong deployment. The env vars were set on dev (`npx convex env set X=Y`) but the cron is firing on prod.

**Fix:**
```bash
npx convex env list --prod         # confirm which env vars are set on prod
npx convex env set TELEGRAM_BOT_TOKEN=<...> --prod
npx convex env set TELEGRAM_CHAT_ID=<...> --prod
npx convex env set TELEGRAM_WEBHOOK_SECRET=<...> --prod
```

---

## 4. 401 from getMe

**Symptom:**
```bash
curl https://api.telegram.org/bot<token>/getMe
# {"ok":false,"error_code":401,"description":"Unauthorized"}
```

**Cause:** Token is wrong, was revoked, or was rotated and you're using the old one.

**Fix:** BotFather → `/revoke` to confirm and rotate; then `npx convex env set TELEGRAM_BOT_TOKEN=<new>` + re-register the webhook.

---

## 5. PowerShell + curl: `URL rejected: Bad hostname`

**Symptom:**
```
curl ... -d 'allowed_updates=["message"]'
# curl: URL rejected: Bad hostname
```

**Cause:** PowerShell parses `[` as a glob/range character before curl sees it. The `-d` body is mangled.

**Fix:** Use the provided `scripts/register-webhook.mjs`. It constructs the JSON body in-process so PowerShell never sees brackets on the command line.

---

## 6. "Diverging branches" after squash-merge

**Symptom:** After merging your PR (squash), `git pull` says you've diverged.

**Cause:** Squash-merge produces a single new commit on `main`. Your local branch has the original commit chain.

**Fix:**
```bash
git fetch origin
git checkout main
git reset --hard origin/main
```

---

## 7. Convex `.lte("optionalField", X)` returns rows you don't expect

**Symptom:** Your range query on an optional indexed field includes rows where the field is `undefined`.

**Cause:** Convex stores absent optional fields as `undefined`, and `undefined` sorts BEFORE all numeric values in an index. `.lte("dueDate", X)` literally includes undefined rows because they're below X in index order.

**Fix:** post-collect filter:
```ts
const collected = await ctx.db.query("...").withIndex("...").collect();
for (const o of collected) if (o.dueDate !== undefined) keep.push(o);
```

See `convex/examples/packList/packListQuery.ts` for a working example. LESSON 1.

---

## 8. WIB-midnight (local-midnight) test flake

**Symptom:** Tests pass locally during the day but fail on CI if the runner happens to be near local midnight in the target timezone.

**Cause:** Tests compute "today" or "yesterday" from `Date.now()`. Near local midnight, the date math crosses the boundary and the date-string assertions break.

**Fix:** Use `noonLocalTodayMs(timeZone)` from `convex/lib/dateAnchors.ts` as the test clock anchor. Pinning to noon gives 12h margin in both directions.

---

## 9. Telegram returns 400 "message is too long"

**Symptom:** Convex logs show a 400 from `sendMessage`. The pack list is long.

**Cause:** Telegram's hard limit is 4096 chars per message. Our `chunkItems` caps each chunk at 4000 (safety margin) and truncates individual oversized items at 3800. But if you set a custom `maxChunkLen` higher than 4096, or your continuation header pushes the chunk over, you'll hit the limit.

**Fix:** Check the `maxChunkLen` and `maxItemLen` values used in `chunkItems` calls. The defaults are conservative. See `convex/lib/chunking.ts` and LESSON 3.

---

## 10. Dev/prod env-var leakage — duplicate sends

**Symptom:** Every cron fires twice. Or `/ping` returns two messages.

**Cause:** Same bot token configured on BOTH dev and prod deployments. Both webhooks fire on the same Telegram callback. Both crons run on their own schedule.

**Fix:** Pick ONE deployment to own the bot in production:
```bash
# Unset dev's bot config so dev never fires for this bot
npx convex env unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
# Keep prod's config intact
```
Better long-term: separate bots for dev and prod (see SETUP step 9).

---

## 11. Group → supergroup migration broke the bot

**Symptom:** Bot suddenly stops posting. `getWebhookInfo` shows `last_error_message: "Bad Request: chat not found"` OR the cron throws on `sendMessage`.

**Cause:** Telegram migrated your regular group to a supergroup. The chat_id changed from `-NNN` to `-100NNN`. Your configured `TELEGRAM_CHAT_ID` is now stale.

**Fix:**
1. Send a message in the supergroup that mentions the bot (e.g. "@your_bot test").
2. Fetch the new chat ID:
   ```bash
   curl "https://api.telegram.org/bot<token>/getUpdates"
   ```
   Look for `"chat": {"id": -100..., "type": "supergroup"}`.
3. Update the env var:
   ```bash
   npx convex env set TELEGRAM_CHAT_ID=-100NNN --prod
   ```
   (Note the `=value` form — needed for negative IDs, see SETUP step 4.)
4. Smoke-test:
   ```bash
   npx convex run examples/helloWorld/sendHello:sendHello '{"reason":"command"}' --prod
   ```

This is expected somewhere in the lifecycle of every bot whose chat outgrows the regular-group cap. LESSON 9.
