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

---

## 12. Scheduled message never arrived (transient worker spike)

**Symptom:** A cron-scheduled post (daily digest, pack list) simply didn't show
up. No error in the chat. The Convex Schedules tab shows the cron fired. Logs
show something like:
```
[CONVEX Q(telegram/chatRegistry:getChatIdByRole)] There are no available workers to process the request
[CONVEX A(.../sendX:sendX)] Uncaught Error: There are no available workers to process the request
```

**Cause:** Convex crons fire **exactly once, no auto-retry**. A transient
capacity error (`"no available workers"`) hit the send-action's first step (the
`getChatIdByRole` runQuery) *before* anything was sent, and the post was silently
dropped.

**Fix (immediate):** re-issue it on demand — run the raw send-action by hand:
```bash
npx convex run examples/packList/sendPackList:sendPackList '{"reason":"command"}' --prod
```

**Fix (permanent):** point the cron at a `*Resilient` wrapper, not the raw send.
The wrapper retries transient errors only (60s / 120s, 3 attempts) and
self-reschedules. See `convex/lib/cronRetry.ts`, ARCHITECTURE.md § "Cron
resilience", and LESSON 10. Crons → wrapper; on-demand path → raw action.

---

## 13. `/register` did nothing

**Symptom:** You sent `/register@<bot>` in a group and got no reply. The chat
never appears in the admin UI. Convex logs show no incoming webhook for it.

**Causes & fixes, in order of likelihood:**

1. **`register` isn't in `/setcommands`.** Privacy mode (ON by default) means the
   bot only sees registered commands and @mentions. Add `register` (and `start`)
   via BotFather `/setcommands` — see SETUP step 7 / 2.4. Wait ~30s for the cache.
2. **Webhook `allowed_updates` excludes `"message"`.** If the webhook was
   registered without `"message"` in `allowed_updates`, the `/register` text
   update is filtered out before reaching the webhook. Re-register with
   `node scripts/register-webhook.mjs …` (it includes `"message"`). Verify with
   `getWebhookInfo` → check `allowed_updates`.
3. **Bot isn't actually in the group**, or was removed. Re-add it as a member.
4. **`TELEGRAM_ADMIN_URL` / `TELEGRAM_BOT_USERNAME` unset** — registration still
   works, but the reply shows the placeholder URL/name. Set them (SETUP 2.1).

---

## 14. Admin UI shows "Invalid admin key"

**Symptom:** The React admin app refuses every call with `Invalid admin key` or
`ADMIN_KEY env var is not set — refusing admin calls`.

**Cause:** The `ADMIN_KEY` the app sends (stored in `localStorage`) doesn't match
the `ADMIN_KEY` env var on the deployment — or the env var is unset (the gate
**fails closed**).

**Fix:**
```bash
npx convex env list                 # confirm ADMIN_KEY is set on this deployment
npx convex env set ADMIN_KEY=<secret>   # set it if missing (generate via new-webhook-secret.mjs)
```
Then re-enter the key in the admin UI (clear it from `localStorage` if it cached
a stale value). Make sure you're pointing at the right deployment — `VITE_CONVEX_URL`
must match the deployment whose `ADMIN_KEY` you set. See SECURITY.md.

---

## 15. Role assigned but messages still go to the old group

**Symptom:** You assigned a role to a new chat, but posts keep landing in the
previous group (or nowhere you expect).

**Causes & fixes:**

1. **The env fallback is still set.** If `TELEGRAM_FALLBACK_ROLE` matches the
   role AND `TELEGRAM_CHAT_ID` is set, step 2 of the lookup chain *only* fires
   when no active row matches — so this is rarely the culprit once a row exists.
   But if assignment didn't actually take, the fallback masks the failure. Confirm
   the row is active:
   ```bash
   npx convex run telegram/chatRegistry:listChats '{"includeArchived":true}'
   ```
   Look for your chatId with the expected `role` and **no** `archivedAt`.
2. **The target row is archived.** Assigning a role to an archived chat is a
   dead-end — `getChatIdByRole` skips archived rows. Restore + assign atomically:
   ```bash
   # via admin UI: "Restore and assign?"  — or:
   npx convex run telegram/chatRegistry:assignRole '{"chatId":"-100...","role":"alerts","restoreIfArchived":true}'
   ```
3. **Another chat still holds the role.** Role uniqueness means assigning to a new
   chat throws unless you override:
   ```bash
   npx convex run telegram/chatRegistry:assignRole '{"chatId":"-100...","role":"alerts","forceReassign":true}'
   ```
   `forceReassign` clears the old holder's role and moves it in one mutation.
4. **Migration leftover.** Once fully on the registry, unset the shim so the env
   path can't shadow anything: `npx convex env unset TELEGRAM_FALLBACK_ROLE`.

---

## 16. Chat vanished after group upgraded to supergroup

**Symptom:** A previously-working feed went quiet. The chat's row still exists but
its `lastError` shows `Bad Request: chat not found`, or sends throw on that id.

**Cause:** Telegram migrated the regular group to a supergroup; the chat id
changed from `-NNN` to `-100NNN`. The old id is inert. The registry doesn't
auto-handle `migrate_to_chat_id` (deferred), so the old row points at a dead id.

**Fix (manual recovery):**
1. Archive the old row (frees its role slot):
   ```bash
   npx convex run telegram/chatRegistry:archiveChat '{"chatId":"-987654321"}'
   ```
2. Ensure the bot is in the new supergroup (usually carried over with members).
3. Send `/register@<bot>` in the supergroup — registers the new `-100…` id.
4. Assign the same role to the new row:
   ```bash
   npx convex run telegram/chatRegistry:assignRole '{"chatId":"-100987654321","role":"pack-list"}'
   ```

See SELF-REGISTRATION.md § "Group → supergroup migration recovery". Related to
the v1 env-var version of this trap in #11.
