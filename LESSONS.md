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
npx convex env set TELEGRAM_CHAT_ID <your-chat-id>
# error: unknown option '<your-chat-id>'
```

The CLI's positional-argument parser sees negative chat IDs (like `-100<digits>` for supergroups) as flags. Confusingly, this only bites with chat IDs (which are always negative for groups/supergroups).

**Fix:** Use the `key=value` form:
```bash
npx convex env set TELEGRAM_CHAT_ID=<your-chat-id>
```

---

## 9. Group → supergroup migration changes chat_id shape

**The trap:** Your bot works fine in a regular group with chat_id `-123456789`. The group hits 200+ members and Telegram migrates it to a supergroup. The chat_id silently becomes `-100<digits>` (the supergroup format). Your bot, configured with the old ID, stops posting.

**Fix:** Watch for it. See RUNBOOK #11 for the recovery sequence. It's expected somewhere in the lifecycle of every long-running bot whose chat grows past the regular-group cap.

---

# v2 lessons — self-registration & multi-chat routing

---

## 10. Convex crons fire once with no retry — a transient worker spike silently drops a scheduled send

**The trap:** A cron-scheduled post just doesn't arrive. No error in the chat. The
send-action's first step is a `getChatIdByRole` runQuery; if a transient Convex
capacity error (`"There are no available workers to process the request"`) hits at
firing time, that query throws *before any message is sent* and the post is lost.
Convex crons fire **exactly once with no auto-retry**, so there's no second chance.
(This dropped the source project's midday digest on 2026-05-29.)

**The fix:** A thin `*Resilient` wrapper `internalAction` per cron-triggered send.
It runs the real send via `ctx.runAction`; on a **transient error only**, it
self-reschedules a backed-off retry (`scheduler.runAfter`, 60s/120s, 3 attempts);
anything else rethrows so it surfaces in the cron dashboard. Crons point at the
wrapper; the on-demand path (slash command, admin test-send) keeps calling the raw
action — a human who sees no reply just re-issues it. See `convex/lib/cronRetry.ts`.

**Three rules that keep retries safe:**
1. **Retry transient errors only.** `isTransientError` matches just the Convex
   overload substring, which can only occur *before* the send loop. A mid-send
   Telegram failure doesn't match — retrying it would double-post earlier chunks.
2. **Pre-send work that re-runs on retry must be idempotent** (an incremental data
   refresh is fine; a non-idempotent write is not).
3. **One wrapper per action, not a generic one.** `scheduler.runAfter` needs a
   concrete function reference to reschedule, and references aren't serialisable as
   args — so each wrapper must name itself. Only the *policy* is shared.

---

## 11. Role-indirection decouples a feed's identity from a chat id

**The insight:** v1 hard-coded the destination in `TELEGRAM_CHAT_ID` — coupling a
feed's *identity* ("the pack list") to a concrete *chat id*. Repointing meant an
env edit + redeploy. Putting a stable **role** ("pack-list") between the send-action
and the chat id, and resolving `role → chatId` at **send time** via
`getChatIdByRole`, moves the binding into data. Repointing a feed becomes a row
patch in the admin UI. No cached chat id exists anywhere; the freshest binding
always wins. Adding a feed is: a role string in `config.ts` + a send-action — no
new env var.

---

## 12. Archived rows MUST clear their role slot, atomically

**The trap:** Soft-delete by setting `archivedAt` alone leaves the row still
"holding" its role. Because role uniqueness is enforced by querying for an active
holder, an archived-but-role-bearing row blocks reassigning that role to a live
chat — and `getChatIdByRole` (which only matches `archivedAt === undefined`) skips
it, so the feed silently routes nowhere.

**The fix:** `archiveChat` patches `archivedAt` **and** clears `role` in one
mutation — the slot frees immediately. Symmetrically, assigning a role to an
archived chat is refused unless the caller passes `restoreIfArchived: true`, which
un-archives + assigns in a single atomic write (the admin UI's "Restore and
assign?"). Never split these into two writes — a crash between them leaves an
inconsistent slot.

---

## 13. The `archivedAt`-undefined index ordering trap → one compound index

**The trap:** You want two access paths: "active row for role X" and "list of active
chats". The naive design is a `by_role` index + a post-scan `.filter(r =>
r.archivedAt === undefined)`. But Convex sorts `undefined` (an absent optional)
*before* all defined values in an index — the same trap as LESSON 1. An
`archivedAt`-only index is unsafe for the same reason, and a `by_role` index pushes
the active-check into a post-scan filter.

**The fix:** A single compound index `by_role_archived` on `["role", "archivedAt"]`.
`getChatIdByRole` queries `.eq("role", role).eq("archivedAt", undefined)` — both
bounds inside the index, no post-scan filter. The same index serves the active-list
path. For the full chat list (which includes archived), the table is bounded (one
row per registered chat, typically < 100) so a `.collect()` + in-memory filter is
cheap and sidesteps the ordering trap entirely.

---

## 14. Internal-core + key-gated public wrapper — one impl, two auth surfaces

**The pattern:** Each management op (list / assignRole / archive / restore /
test-send) has a private `…Impl` function plus two thin registrations: an
`internal*` (`internalQuery`/`internalMutation`/`internalAction`, callable from the
dashboard or `npx convex run`, no key) and an `admin*` (public, takes an `adminKey`
arg, calls `requireAdminKey` then delegates to the same `…Impl`). No logic is
duplicated; only the auth gate differs.

**Why:** The starter has no user/session system, so the React admin app needs *some*
gate — a single `ADMIN_KEY`, constant-time compared, **fail-closed when unset**.
But operators with dashboard access shouldn't need a key at all (internal functions
aren't publicly reachable). The split serves both without forking the implementation.
When you embed this in an app that has real users, replace `requireAdminKey` with
your auth (`requireRole`, session token) — only the `admin*` wrappers change.

---

## 15. The webhook's `MessageContext` — evolving a command signature without breaking callers

**The trap:** v1 commands were zero-parameter (`dispatch: async () => {…}`). v2's
`/register` needs to know *which* chat sent it — chat id, type, title, sender. Adding
those as positional args would break every existing command.

**The fix:** A single `MessageContext` object passed to every `dispatch`
(`chatId`, `chatType`, `title`, `fromId`, `text`). Commands that need it read it;
commands that don't (`/ping`) ignore the argument — a zero-parameter
`dispatch: async () => {…}` is still assignable to `(msg: MessageContext) =>
Promise<void>`. One backward-compatible signature evolution carried both the old
commands and the new registry built-ins. The webhook also normalizes chat id to a
**string** here (sidesteps the `-100…` supergroup number range) and coerces unknown
chat types to `"group"`.
