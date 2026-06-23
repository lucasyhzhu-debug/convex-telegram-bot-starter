# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## [0.3.0] - 2026-06-23

Knowledge inbox + external "brain" — this deployment (`@LucasKnowledgeBot`)
becomes the **transport + memory layer** for an external Claude Code agent
(`wiki-brain`) that maintains a personal markdown wiki. Clean split: **Convex =
transport + memory + Telegram I/O; the external agent = the intelligence.**
Convex captures, queues, logs, and routes; a local worker polls the inbox and
runs the brain headlessly (`claude -p "/process-inbox"`). Convex never runs the
LLM. The v2 self-registration / multi-chat path keeps working unchanged.

### Added

- **Knowledge-inbox capture.** Any non-command text message is deduped (by
  `update_id`), classified **save vs ask**, enqueued to a new `inbox` table, and
  gets an instant ack ("saving this…" / "looking that up…"). Slash commands are
  never captured. Classification (`convex/inbox/capture.ts`): a URL, an
  `under <category>` prefix, or a `#tag` → **save**; plain prose → **ask**;
  `save:` / `ask:` prefixes force the op. `under <cat>` / `#tag` set the
  category; default is `inbox` (or `ask` for questions).
- **`inbox` table** (`convex/schema.ts`, `by_status` index): `category`,
  `source`, `kind` (`url`|`text`|`youtube`), `status` (`pending`|`drained`),
  `createdAt`, `chatId`, optional `raw`, optional `op` (`save`|`ask`).
- **`inbox.ts` functions:** public `listPending({limit})` →
  `[{id,op,category,source,kind,chatId}]` (oldest-first), public
  `markDrained({ids})` (idempotent), internal `enqueue`. The two public
  functions are intentionally unauthenticated — they are the drain worker's API.
- **Full conversation log + sessions.** New `messages` table (every inbound /
  outbound turn: `chatId`, `direction` `in`|`out`, `text`, optional `intent`
  `save`|`ask`|`command`|`other`, `op?`, `threadId?`, `updateId?`, `createdAt`;
  `by_chat_created` + `by_created` indexes) and `threads` table (per-chat session
  windowing: `chatId`, `startedAt`, `lastActiveAt`, `status` `active`|`idle`,
  optional `summary`; `by_chat` index). A thread stays active while messages
  arrive within `THREAD_IDLE_MS` (3 h); after that the next message opens a fresh
  thread.
- **`messages.ts` functions:** internal `logMessage`, internal `resolveThread`
  (get-or-open the active thread), internal `resetActiveThread`, public
  `getSessionContext({chatId,limit})` → recent active-thread turns, public
  `listSince({sinceMs,limit})` → all messages in a time range.
- **`POST /post-message`** (`convex/http.ts`) — secret-protected outbound send.
  Header `X-Telegram-Bot-Api-Secret-Token` (reuses `TELEGRAM_WEBHOOK_SECRET`,
  constant-time compared), body `{ html, chatId? | role? }`. Resolves
  `chatId` directly or `role` via `getChatIdByRole`, sends chunked via
  `sendTelegramHtml`, and logs the outbound turn. This is how the external brain
  posts answers, per-source summaries, and the daily digest back to Telegram.
- **`/new` command** (`convex/telegram/threadCommands.ts`) — resets the active
  thread so the next message opens a fresh session (prior context dropped).
- **`"brain"` role** added to `KNOWN_TELEGRAM_ROLES` — the digest destination.
- **Tests:** 180 passing (capture parsing/classification, thread windowing,
  message log, `/post-message` auth + routing).

### Changed

- **`buildHandleTelegramWebhook`** gained a `{ captureInbox?: boolean }` option.
  With it, non-command text is scheduled to `inbox.capture.captureAndAck` after
  the dedupe row commits — best-effort, never blocks the 200 ACK.
- **`convex/http.ts`** no longer registers the `helloWorld` / `packList` example
  commands — this deployment is a knowledge bot, not the FMCG demo. The example
  files remain on disk as reference. The webhook now wires
  `buildThreadCommands` (for `/new`) alongside `buildRegistryCommands`.

[0.3.0]: https://github.com/lucasyhzhu-debug/convex-telegram-bot-starter

## [0.2.0] - 2026-05-29

Self-registering multi-chat routing — the headline v2 feature. Chats register
themselves, you route feeds to groups by semantic role, and you re-point a feed
from a UI with no redeploy. The v1 single-chat path keeps working unchanged.

### Added

- **Self-registration registry.** New `telegramChats` table (`convex/schema.ts`)
  with `by_chatId` and `by_role_archived` indexes. An operator adds the bot to a
  group and sends `/register@<bot>`; the webhook records a row and the bot replies
  with a link to the admin UI. No `curl …/getUpdates`, no env edits.
- **Role indirection.** `KNOWN_TELEGRAM_ROLES` in `convex/telegram/config.ts`
  defines semantic delivery roles. Send-actions call
  `getChatIdByRole({ role })` to resolve role → chatId at send time, so a feed is
  re-pointable from the admin UI with no code change. Role uniqueness enforced
  (one active chat per role; `forceReassign` overrides).
- **Three-step lookup chain** in `getChatIdByRole`: active table row → env
  fallback (`TELEGRAM_FALLBACK_ROLE` + `TELEGRAM_CHAT_ID`, a migration shim) →
  throw. Keeps the v1 single-chat path alive during migration.
- **Chat lifecycle:** dormant → active → archived (soft-delete that clears the
  role slot). `restoreIfArchived` un-archives and assigns atomically.
  `seedChatFromEnv` one-shot bootstrap migrates off the legacy env var.
- **Built-in webhook commands** `/register` and `/start`
  (`convex/telegram/registryCommands.ts`), wired in `convex/http.ts` alongside
  feature commands.
- **React admin app** at `/admin/telegram-chats` — list/assign-role/archive/
  restore/test-send, backed by `ADMIN_KEY`-gated public `admin*` functions. Run
  with `npm run dev:web`.
- **Cron resilience** (`convex/lib/cronRetry.ts`): a `*Resilient` wrapper pattern
  that retries transient Convex capacity errors (60s/120s, 3 attempts) so a
  scheduled post isn't silently dropped. Transient-only, idempotent pre-send,
  per-action self-rescheduling.
- **New env vars** (see `.env.example`): `ADMIN_KEY`, `TELEGRAM_BOT_USERNAME`,
  `TELEGRAM_ADMIN_URL`, `TELEGRAM_FALLBACK_ROLE`, `VITE_CONVEX_URL`.
- **Docs:** new `docs/ARCHITECTURE.md` (bot→groups→roles model, diagrams) and
  `docs/SELF-REGISTRATION.md` (operator/developer/migration walkthrough); README
  "What's new in v2"; SETUP "Part 2 — Self-registration & multi-chat routing";
  new RUNBOOK entries (#12–16); new LESSONS (#10–15); SECURITY ADMIN_KEY section
  and admin-surface threat model.

### Changed

- **Webhook now passes a `MessageContext`** (`chatId`, `chatType`, `title`,
  `fromId`, `text`) to every command `dispatch`. Backward-compatible —
  zero-parameter dispatches (e.g. `/ping`) still work.
- **`buildHandleTelegramWebhook`** gained a `{ trackLastSeen?: boolean }` option;
  with it, non-command messages best-effort `touchChatLastSeen` so the admin UI
  shows live activity. Never deduped, never blocks the 200 ACK.
- **`TELEGRAM_CHAT_ID` is no longer required** when using the registry — it
  becomes the optional env-fallback source during migration.
- SECURITY: the "multi-chat routing" and "chat_id allow-listing" sections —
  previously deferred to "a v2 hardening exercise" — now describe shipped
  behavior.

[0.2.0]: https://github.com/lucasyhzhu-debug/convex-telegram-bot-starter
