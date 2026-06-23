# ARCHITECTURE — bot, groups, roles, and the send path

This doc is the mental model behind v2. If you want the step-by-step operator
walkthrough, read [SELF-REGISTRATION.md](./SELF-REGISTRATION.md) instead — this
explains *why* the pieces are shaped the way they are.

---

## The one-line model

```
register a chat once  →  give it a role in the admin UI  →  feeds route by role
```

A Telegram chat tells the bot "I exist" (via `/register@<bot>`). An operator
gives that chat a *semantic role* ("pack-list", "alerts", …) in the admin UI.
Your send-actions ask for a role, not a chat id — so re-pointing a feed to a
different group is a UI click, not a code change.

---

## The full picture

```
 ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
 │  Group A    │   │  Group B    │   │  Group C    │      Telegram chats
 │ "Warehouse" │   │ "Exec team" │   │ "On-call"   │
 └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
        │  /register@bot  │                 │
        ▼                 ▼                 ▼
 ╔════════════════════════════════════════════════════╗
 ║  POST /telegram-webhook  (convex/telegram/webhook)  ║
 ║   • verify X-Telegram-Bot-Api-Secret-Token (401)    ║
 ║   • match command → /register, /start, /pack, …     ║
 ║   • non-command text → touchChatLastSeen (best-eff) ║
 ╚════════════════════════════╤═══════════════════════╝
                              │ /register → registerChat
                              ▼
 ┌────────────────────────────────────────────────────┐
 │  telegramChats table  (one row per chat)            │
 │  chatId · chatType · title · registeredBy · ...     │
 │  role (optional)  ← assigned in the admin UI        │
 │  archivedAt (optional) · lastSeenAt · lastError     │
 └───────────────────────────┬────────────────────────┘
                              │ assignRole (admin UI / CLI)
                              ▼
        role "pack-list" ──→ Group A      role "alerts" ──→ Group C
                              ▲
                              │ getChatIdByRole({ role }) at SEND time
                              │
 ┌────────────────────────────┴───────────────────────┐
 │  send-action (sendPackList, your sendAlerts, …)     │
 │    1. const chatId = getChatIdByRole({ role })      │
 │    2. format message                                │
 │    3. sendTelegramHtml(token, chatId, html)         │
 └────────────────────────────┬───────────────────────┘
                              ▼
                       back to the group
```

---

## Why role-indirection

In v1 the destination was `process.env.TELEGRAM_CHAT_ID` — one env var, one
group, edited by hand and requiring a redeploy to change. That couples a feed's
*identity* ("the pack list") to a concrete *chat id* ("-100123…"). When the group
splits, migrates to a supergroup, or you want to point the same feed at a
different team, you edit env vars and redeploy.

v2 breaks that coupling with a level of indirection:

- A **role** is a stable, human-meaningful name for a destination ("pack-list").
  Roles live in code (`KNOWN_TELEGRAM_ROLES` in `convex/telegram/config.ts`).
- A **chat** is a concrete Telegram group, captured in the `telegramChats` table
  when it sends `/register`.
- The **binding** between them (`role → chatId`) lives in data, mutated through
  the admin UI. Repointing a feed is a row patch, not a deploy.

Send-actions resolve `role → chatId` at **send time** via `getChatIdByRole`, so
the freshest binding always wins. There is no cached chat id anywhere.

---

## The lookup chain (`getChatIdByRole`)

`getChatIdByRole({ role })` is an `internalQuery` that resolves a role to a
concrete chat id in three steps:

| # | Step | Condition | Result |
|---|------|-----------|--------|
| 1 | Active table row | a `telegramChats` row with `role === role` and `archivedAt === undefined` | `row.chatId` |
| 2 | Env fallback | `TELEGRAM_FALLBACK_ROLE === role` **and** `TELEGRAM_CHAT_ID` is set | that env chat id |
| 3 | Throw | neither | `Error("No Telegram chat assigned to role '<role>'")` |

Step 2 is the **migration shim**: it lets the legacy single-chat env path keep a
feed alive while you move it onto the registry. On a greenfield install you leave
`TELEGRAM_FALLBACK_ROLE` unset and only steps 1 and 3 apply.

---

## Two sources of webhook commands

The webhook routes every matched slash command to a `CommandRegistration`
(`name` + `dispatch`). v2 commands come from two places, concatenated in
`convex/http.ts`:

1. **Built-in registry commands** — `buildRegistryCommands(scheduler)` in
   `convex/telegram/registryCommands.ts` supplies `/register` and `/start`. These
   are the self-registration plumbing and ship verbatim.
2. **Your feature commands** — `buildPackListCommands`, `buildHelloWorldCommands`,
   and whatever you add. Each is a `build…Commands(scheduler)` factory returning
   `CommandRegistration[]`.

```ts
// convex/http.ts
handler: buildHandleTelegramWebhook(
  (scheduler) => [
    ...buildRegistryCommands(scheduler),   // /register, /start
    ...buildHelloWorldCommands(scheduler), // /ping
    ...buildPackListCommands(scheduler),   // /pack
  ],
  { trackLastSeen: true },                 // wire non-command text → touchChatLastSeen
)
```

Each `dispatch` receives a `MessageContext` (`chatId`, `chatType`, `title`,
`fromId`, `text`). v2 added this so `/register` can read *which* chat sent it.
Commands that don't need it (like `/ping`) simply ignore the argument.

The factory takes `scheduler` because `dispatch` typically calls
`scheduler.runAfter(0, internal.X.Y, args)`, and `ctx.scheduler` is only valid
*inside* the httpAction — never at module scope.

### Non-command messages → `touchChatLastSeen`

With `{ trackLastSeen: true }`, any text that isn't a known command (and any
non-text update like a sticker) triggers a best-effort `touchChatLastSeen`,
stamping `lastSeenAt` on the chat's row so the admin UI shows live activity. It
is never deduped and never blocks the 200 ACK. Unknown *slash* commands (a typo)
are NOT touched — only genuine chat activity. `touchChatLastSeen` is
update-only: it never inserts an unknown chat, because seeing a message is not
registration intent — only `/register` registers.

---

## Two management surfaces: `internal*` and `admin*`

Every registry management op (list, assign role, archive, restore, test-send)
exists in two forms sharing one implementation:

| Surface | Definition kind | Caller | Auth |
|---------|-----------------|--------|------|
| `internal*` | `internalQuery` / `internalMutation` / `internalAction` | Convex dashboard, `npx convex run` | none — internal functions aren't publicly callable |
| `admin*` | public `query` / `mutation` / `action` | the React admin app | `ADMIN_KEY` env var, constant-time compared |

So `listChats` / `assignRole` / `archiveChat` / `restoreChat` / `sendTestMessage`
have `adminListChats` / `adminAssignRole` / … twins. The `admin*` twins take an
`adminKey` arg, call `requireAdminKey(adminKey)` (which **fails closed** if
`ADMIN_KEY` is unset), then delegate to the same `…Impl` function the internal
twin uses. No logic is duplicated; only the auth gate differs.

This split exists because the starter has no user/session system of its own. The
`ADMIN_KEY` shim is the minimum viable auth for the bundled admin app. When you
embed this in an app that already has users, replace `requireAdminKey` with your
real auth (session token / `requireRole`) — see
[SECURITY.md](../SECURITY.md).

---

## Chat lifecycle

```
   /register          assignRole(role)
  ┌────────┐  ───────▶ ┌────────┐  ───────▶ (feeds route here)
  │ DORMANT│           │ ACTIVE │
  │(no role)│ ◀─────── │(has role)│
  └────┬───┘  assignRole(null)  └───┬────┘
       │                            │
       │ archiveChat                │ archiveChat
       ▼                            ▼
   ┌──────────────────────────────────┐
   │  ARCHIVED  (archivedAt set,       │
   │  role cleared — slot freed)       │
   └──────────────┬───────────────────┘
                  │ restoreChat  /  assignRole(restoreIfArchived: true)
                  ▼
              DORMANT / ACTIVE
```

- **Dormant** — registered, no role. Visible in the admin UI, routes nothing.
- **Active** — has a role. `getChatIdByRole` resolves to it.
- **Archived** — soft-deleted. Archiving **clears the role atomically** so the
  role-uniqueness slot frees immediately and `getChatIdByRole` skips it (it only
  matches `archivedAt === undefined`). Archived rows are inert: even
  `touchChatLastSeen` ignores them.

`restoreChat` un-archives. `assignRole(…, { restoreIfArchived: true })`
un-archives **and** assigns in a single atomic write, backing the admin UI's
"Restore and assign?" flow.

**Role uniqueness** is enforced: at most one active chat per role. Reassigning a
role that's already held throws unless you pass `forceReassign: true`, which
clears the old holder's role and moves it to the target in one mutation.

---

## Cron resilience (`convex/lib/cronRetry.ts`)

Convex crons fire a function **exactly once with no auto-retry**. A send-action's
first step is usually `getChatIdByRole` (a `runQuery`). If a transient Convex
capacity error — `"There are no available workers to process the request"` —
coincides with the firing time, that query throws *before any message is sent*
and the scheduled post is **silently dropped**: no error in the chat, just a
missing message. (This dropped the source project's midday digest on 2026-05-29.)

The fix is a thin `*Resilient` wrapper `internalAction` per cron-triggered send:

```
   cron  ──▶  sendXResilient (wrapper)
                  │
                  │ ctx.runAction(sendX)
                  ▼
                sendX  ──▶ getChatIdByRole ──▶ format ──▶ send
                  │
            on TRANSIENT error only:
            scheduler.runAfter(60s / 120s, sendXResilient, { attempt+1 })
            up to RESILIENT_MAX_ATTEMPTS (3)
```

Three safety rules baked into the policy:

1. **Retry transient errors only.** `isTransientError` matches only the Convex
   overload substring, which can only occur *before* the send loop. A mid-send
   Telegram failure does NOT match, so it's never retried (re-running a
   partially-sent action would double-post).
2. **Pre-send work that re-runs on retry must be idempotent** (e.g. an
   incremental data refresh is fine; a non-idempotent write is not).
3. **One wrapper per action, not a generic one.** `scheduler.runAfter` needs a
   concrete function reference to reschedule, and references aren't serialisable
   as args — so each wrapper must name itself. Only the *policy* (classification
   + backoff) is shared via `cronRetry.ts`.

The **on-demand** path (slash command, admin test-send) keeps calling the raw
`sendX` directly — a human who doesn't see a reply can just re-issue the command.
Only crons point at the wrapper. See
[RUNBOOK.md](../RUNBOOK.md) § "Scheduled message never arrived" and
[LESSONS.md](../LESSONS.md).

---

## Knowledge inbox + external brain (v3)

v2 routes *outbound* feeds to groups. v3 adds the *inbound + memory* half: this
deployment becomes the transport and memory layer for an **external** Claude Code
agent (`wiki-brain`) that owns a personal markdown wiki. The boundary is sharp:

> **Convex = transport + memory + Telegram I/O. The external agent = the
> intelligence.** Convex cannot run the LLM, so it never tries — it captures,
> queues, logs, and routes.

```
 ┌───────────┐  text msg   ╔══════════════════════════════════════════╗
 │ Telegram  │ ──────────▶ ║  POST /telegram-webhook                  ║
 │  (you)    │             ║   • dedupe (recordIfNew, update_id)      ║
 └───────────┘             ║   • non-command text → captureAndAck     ║
       ▲                   ╚════════════════════╤═════════════════════╝
       │ ack / answer                           │ schedule.runAfter(0)
       │ (sendTelegramHtml)                     ▼
       │                   ┌──────────────────────────────────────────┐
       │                   │ captureAndAck (internalAction)           │
       │                   │  1. resolveThread  (sessions)            │
       │                   │  2. logMessage (in)  → messages table    │
       │                   │  3. classifyIntent → save | ask          │
       │                   │  4. enqueue → inbox table (pending)      │
       │                   │  5. instant ack  → logMessage (out)      │
       │                   └──────────────────────────────────────────┘
       │                                        │
       │           ┌─────────── Convex /api (public, unauthenticated) ┐
       │           │ inbox.listPending / inbox.markDrained            │
       │           │ messages.getSessionContext / messages.listSince  │
       │           └──────────────────────┬───────────────────────────┘
       │                                  │ poll
       │              ┌───────────────────▼───────────────────┐
       │              │ local worker:  claude -p "/process-inbox"│
       │              │   = wiki-brain (the intelligence)        │
       │              └───────────────────┬───────────────────┘
       │  POST /post-message               │
       └───────────────────────────────────┘
          (X-Telegram-Bot-Api-Secret-Token)
```

### The three tables

| Table | Index(es) | Purpose |
|-------|-----------|---------|
| `inbox` | `by_status` | One row per captured item the brain must process. `category`, `source`, `kind` (`url`\|`text`\|`youtube`), `status` (`pending`\|`drained`), `createdAt`, `chatId`, optional `raw`, optional `op` (`save`\|`ask`). |
| `messages` | `by_chat_created`, `by_created` | Append-only log of **every** turn. `chatId`, `direction` (`in`\|`out`), `text`, optional `intent` (`save`\|`ask`\|`command`\|`other`), `op?`, `threadId?`, `updateId?`, `createdAt`. |
| `threads` | `by_chat` | Session window. `chatId`, `startedAt`, `lastActiveAt`, `status` (`active`\|`idle`), optional `summary`. |

### Capture + intent model

The webhook is wired with `{ trackLastSeen: true, captureInbox: true }`. Capture
only fires for **non-command text** (slash commands — `/register`, `/start`,
`/new` — are never captured), and only **after `recordIfNew` commits** for that
`update_id`, so Telegram retries never double-insert. The capture itself is
scheduled (`runAfter(0, inbox.capture.captureAndAck)`) — best-effort, never
blocking the 200 ACK.

`captureAndAck` then `classifyIntent`s the message (`convex/inbox/capture.ts`):

| Signal | Result |
|--------|--------|
| `save:` prefix | `op = save` |
| `ask:` prefix | `op = ask`, category `ask` |
| contains a URL | `op = save` (kind `youtube` if a youtu.be/youtube link, else `url`) |
| `under <category>` prefix or `#tag` (leading/trailing) | `op = save`, that category |
| plain prose / question | `op = ask`, category `ask` |

The category from `under <cat>` / `#tag` is stripped from `source`; the default
category is `inbox`. The result is logged to `messages` (direction `in`, with
`intent`/`op`), enqueued to `inbox`, and acked instantly ("saving this…" for
save, "looking that up…" for ask).

### Sessions (`threads`)

`resolveThread` reuses the chat's most-recent thread if its `lastActiveAt` is
within `THREAD_IDLE_MS` (3 h); otherwise it marks the old thread `idle` and opens
a fresh `active` one. `getSessionContext({chatId,limit})` returns the recent
turns of the **active** thread (oldest-first) so the brain keeps follow-up
questions coherent; it returns `[]` once the thread has gone idle.
`listSince({sinceMs,limit})` returns all messages in a time range for the weekly
review. `/new` calls `resetActiveThread`, marking the active thread idle so the
next message starts clean.

### The outbound path: `POST /post-message`

This is how the **external brain posts back** — per-source summaries (to the
originating `chatId`), answers, and the daily digest (to role `"brain"`). It is
the mirror image of the webhook:

- **Auth:** header `X-Telegram-Bot-Api-Secret-Token`, constant-time compared
  against `TELEGRAM_WEBHOOK_SECRET` — the *same* secret the webhook uses, reused
  here. 401 on missing/mismatched.
- **Body:** `{ html: string, chatId?: string, role?: string }`. Exactly one of
  `chatId` / `role` is required; `chatId` wins if both present, otherwise `role`
  resolves through `getChatIdByRole` (404 if unassigned — reusing the v2 lookup
  chain).
- **Send:** `sendTelegramHtml(token, chatId, html)` (chunked, same as every
  outbound path), then a best-effort `logMessage` (direction `out`).

### The external-worker pattern

Convex is a serverless runtime — it has no long-lived process to run an agent
loop, and it can't execute the LLM. So the intelligence lives in a **local
worker** outside Convex that:

1. polls `inbox.listPending` over the Convex HTTP `/api`,
2. runs the brain headlessly (`claude -p "/process-inbox"`) — `wiki-brain`
   ingests each source or answers each question against the markdown wiki,
3. posts the result back via `POST /post-message`,
4. calls `inbox.markDrained({ids})` to clear the processed rows (idempotent, so a
   retry after a network blip is safe).

`listPending` / `markDrained` / `getSessionContext` / `listSince` are
**intentionally public and unauthenticated** — they are the worker's API, and the
deployment is single-tenant. (If you embed this in a multi-tenant app, gate them
the same way the v2 `admin*` functions are gated; see SECURITY.md.) Capture
(`enqueue`) stays internal: only the webhook path may write to the inbox.

---

## File map (v2 additions)

| File | Role |
|------|------|
| `convex/schema.ts` | `telegramChats` table + `by_chatId` / `by_role_archived` indexes |
| `convex/telegram/config.ts` | `KNOWN_TELEGRAM_ROLES`, `TELEGRAM_ADMIN_URL`, `TELEGRAM_BOT_USERNAME` — the only file you adapt |
| `convex/telegram/chatRegistry.ts` | the whole registry mechanic (ships verbatim) |
| `convex/telegram/registryCommands.ts` | `/register` + `/start` built-ins |
| `convex/telegram/webhook.ts` | `MessageContext`, `trackLastSeen` option |
| `convex/telegram/commands.ts` | `CommandRegistration`, `MessageContext` |
| `convex/lib/cronRetry.ts` | transient-error retry policy |
| `src/` (React) | the `/admin/telegram-chats` admin app — `npm run dev:web` |

## File map (v3 additions)

| File | Role |
|------|------|
| `convex/schema.ts` | `inbox`, `messages`, `threads` tables + their indexes |
| `convex/inbox.ts` | public `listPending` / `markDrained`, internal `enqueue` |
| `convex/inbox/capture.ts` | `parseCapture` / `classifyIntent` / `detectKind` + `captureAndAck` internalAction |
| `convex/messages.ts` | `logMessage`, `resolveThread`, `resetActiveThread` (internal); `getSessionContext`, `listSince` (public); `THREAD_IDLE_MS` |
| `convex/telegram/threadCommands.ts` | `/new` — reset the active thread |
| `convex/telegram/webhook.ts` | `captureInbox` option + `capture` dep |
| `convex/http.ts` | `POST /post-message` outbound endpoint; example commands de-registered |
| `convex/telegram/config.ts` | `"brain"` role added to `KNOWN_TELEGRAM_ROLES` |
