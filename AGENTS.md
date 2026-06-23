<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Code map (for agents working in this repo)

Two subsystems live here. v2 routes **outbound** feeds to Telegram groups; v3
adds the **knowledge inbox + external brain** (inbound capture + memory). The
intelligence is external — this deployment is **transport + memory + Telegram
I/O only; it never runs an LLM**.

**Tables (`convex/schema.ts`):**
- `telegramChats` — self-registration registry (v2). `by_chatId`, `by_role_archived`.
- `inbox` — captured items the external brain drains. Fields: `category`,
  `source`, `kind` (`url`|`text`|`youtube`), `status` (`pending`|`drained`),
  `createdAt`, `chatId`, `raw?`, `op?` (`save`|`ask`). `by_status`.
- `messages` — append-only log of every turn. `chatId`, `direction` (`in`|`out`),
  `text`, `intent?` (`save`|`ask`|`command`|`other`), `op?`, `threadId?`,
  `updateId?`, `createdAt`. `by_chat_created`, `by_created`.
- `threads` — per-chat session window. `chatId`, `startedAt`, `lastActiveAt`,
  `status` (`active`|`idle`), `summary?`. `by_chat`. Idle after `THREAD_IDLE_MS` (3 h).

**Functions:**
- `inbox.ts` — public `listPending({limit})`, public `markDrained({ids})`,
  internal `enqueue`.
- `inbox/capture.ts` — `parseCapture` / `classifyIntent` / `detectKind` (pure),
  `captureAndAck` (internalAction). Classifies save vs ask.
- `messages.ts` — internal `logMessage`, `resolveThread`, `resetActiveThread`;
  public `getSessionContext({chatId,limit})`, `listSince({sinceMs,limit})`.
- `telegram/threadCommands.ts` — `/new` (reset active thread).
- `telegram/chatRegistry.ts` — registry mechanic incl. `getChatIdByRole` (v2).

**HTTP endpoints (`convex/http.ts`):**
- `POST /telegram-webhook` — inbound updates; wired `{ trackLastSeen: true,
  captureInbox: true }`. Non-command text → deduped capture.
- `POST /post-message` — outbound send for the external brain. Auth header
  `X-Telegram-Bot-Api-Secret-Token` (reuses `TELEGRAM_WEBHOOK_SECRET`). Body
  `{ html, chatId? | role? }`. The example `helloWorld` / `packList` commands are
  no longer registered (files kept as reference).

**Boundary rule:** do not add LLM calls to Convex. Capture (`enqueue`) is
internal; the brain is an external Claude Code agent (`wiki-brain`) driven by a
local worker (`claude -p "/process-inbox"`) that polls `listPending`, posts via
`/post-message`, and calls `markDrained`. See `docs/ARCHITECTURE.md`.
