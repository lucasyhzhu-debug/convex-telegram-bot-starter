# LESSONS — the non-obvious things we learned the hard way

These aren't general Convex/Telegram advice. They're the specific traps that cost hours on the project this starter was extracted from. Each one shipped a fix you can see in the code.

---

## 1. Convex `.lte("optionalField", X)` includes undefined-field rows

**The trap:** Range index bound on an optional field silently includes rows where that field is absent. Convex stores absent optionals as `undefined`, and `undefined` sorts BEFORE all numeric values in an index — so `.lte("dueDate", endOfToday)` returns rows with no `dueDate` set, not just rows with `dueDate <= endOfToday`.

**The fix:** Post-collect JS filter for `field !== undefined`. See `convex/examples/packList/packListQuery.ts:38`.

**Why it's not in the docs:** It IS in the Convex docs but buried. Most developers reasoning about ranges over `number | undefined` would expect `.lte` to skip the undefined rows the way `WHERE x <= ?` does in SQL.

---

## 2. Dedupe-before-action is a permanent 500 retry-loop trap

**The trap:** A webhook handler does `if (await recordIfNew(updateId)) await dispatch();`. If `dispatch()` throws, the handler returns 500. Telegram retries. The retry sees `recordIfNew` returns false (row exists), skips dispatch, returns... whatever. But the original failure has no chance to recover because subsequent retries are short-circuited by the committed dedupe row.

Worse: if you return 500 once recordIfNew commits, Telegram retries for ~24h and you get permanent error spam.

**The fix:** Once the dedupe row is committed, ALWAYS return 200, even if dispatch throws. Catch + warn + ACK. See `convex/telegram/webhook.ts:decideWebhookOutcome` C3 guard.

---

## 3. Chunking budget headroom only handles accumulation overflow — single oversized items need a per-item cap

**The trap:** Telegram's hard limit is 4096 chars. You set `maxChunkLen: 4000` to give 96 chars of safety margin. You correctly split when accumulating items crosses the budget. But ONE item that's itself 5000 chars long blows past 4096 even though the chunk has nothing else in it — your loop creates a single-item chunk above the limit.

**The fix:** Add a per-item cap (`maxItemLen: 3800`). Items above the cap get truncated with a marker `…[truncated — check source]`. See `convex/lib/chunking.ts`.

---

## 4. Plan-stage and impl-stage reviews catch complementary classes of bugs

The pack-list bot this starter extracts from went through a plan-stage staffreview (caught 13 architectural fixes before code was written) AND an impl-stage triple-review (caught 3 more critical bugs only visible in the code, including the dedupe-before-action retry-loop trap).

Skipping either leaves a class of bugs untouched. The architectural questions ("are these the right structural decisions?") are different from the implementation questions ("does this test actually test the invariant it claims?"). You need both lenses.

---

## 5. `_generated/dataModel.d.ts` is generic — schema additions trust type-check, but FUNCTION additions need explicit codegen

The Convex `_generated` directory has a fixed `dataModel.d.ts` template that's generic over the schema (`DataModelFromSchemaDefinition<typeof schema>`). So adding a table doesn't change `dataModel.d.ts` — TypeScript just type-checks against your schema directly.

BUT `api.d.ts` enumerates every exported function module. Adding a new query/mutation/action requires `npx convex codegen` to regenerate `api.d.ts` — otherwise `internal.<your-new-fn>` won't be available at the call site.

**Rule of thumb:** if you add a new table, you don't need codegen for the change to type-check. If you add a new exported function, you DO.

---

## 6. BotFather privacy mode silently swallows commands in groups

**The trap:** Your bot works fine in a 1-on-1 chat with you (typing `/ping` returns a reply). You add the bot to a group, type `/ping`, nothing happens. Convex logs show no incoming webhook.

**Cause:** BotFather defaults new bots to **privacy mode ON**. In privacy mode, the bot only sees messages that (a) mention it `@your_bot`, OR (b) are explicitly registered commands.

**Fix:** Register your commands via BotFather `/setcommands`. After that, Telegram routes `/ping` through privacy mode and the bot sees it. See SETUP step 7.

---

## 7. PowerShell + curl + `[bracket]` arguments

**The trap:**
```powershell
curl -X POST https://api.telegram.org/bot.../setWebhook -d 'allowed_updates=["message"]'
# curl: URL rejected: Bad hostname
```

PowerShell parses `[` as part of its glob/range syntax before curl ever sees the arg. The body string gets mangled.

**Fix:** Construct the JSON body in a process language (Node) and POST via `fetch` instead of curl. See `scripts/register-webhook.mjs`.

---

## 8. `npx convex env set` with negative-value chat IDs

**The trap:**
```bash
npx convex env set TELEGRAM_CHAT_ID -1001234567890
# error: unknown option '-1001234567890'
```

The CLI's positional-argument parser sees `-1001234567890` as a flag. Confusingly, this only bites with chat IDs (which are always negative for groups/supergroups).

**Fix:** Use the `key=value` form:
```bash
npx convex env set TELEGRAM_CHAT_ID=-1001234567890
```

---

## 9. Group → supergroup migration changes chat_id shape

**The trap:** Your bot works fine in a regular group with chat_id `-123456789`. The group hits 200+ members and Telegram migrates it to a supergroup. The chat_id silently becomes `-1001234567890`. Your bot, configured with the old ID, stops posting.

**Fix:** Watch for it. See RUNBOOK #11 for the recovery sequence. It's expected somewhere in the lifecycle of every long-running bot whose chat grows past the regular-group cap.
