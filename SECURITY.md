# SECURITY

The Telegram bot path has a small but real attack surface. This doc names what we're protecting against and how the code does it.

## Threat model

| Threat | Impact | Mitigation |
|--------|--------|-----------|
| Attacker fakes a webhook from "Telegram" | Triggers arbitrary command dispatch | `X-Telegram-Bot-Api-Secret-Token` header + constant-time compare |
| Attacker steals the bot token | Can post anything from the bot | Rotate via BotFather `/revoke`; never log the token |
| Attacker learns the chat_id | Can target the chat IF they also have the token | Chat ID is not a secret; defense is at the token layer |
| Attacker discovers the webhook secret | Can trigger commands at will | Constant-time compare prevents timing oracle; rotate per env |
| Replay attack (same update_id) | Duplicate sends | `recordIfNew` atomic dedupe in `telegramUpdates` |
| Internal dispatch fails after recordIfNew committed | 24h retry-loop from Telegram | C3 guard: catch + warn + 200 |

## Token rotation

1. BotFather → `/revoke` → pick the bot. New token issued.
2. Update both deployments:
   ```bash
   npx convex env set TELEGRAM_BOT_TOKEN=<new-token>          # dev
   npx convex env set TELEGRAM_BOT_TOKEN=<new-token> --prod   # prod (if separate)
   ```
3. Re-register the webhook:
   ```bash
   node scripts/register-webhook.mjs --token=<new-token> --deployment=<...> --secret=<existing-secret>
   ```

Total downtime: under 60 seconds.

## Webhook secret hygiene

- Generate a **fresh** secret per environment. Never share dev↔prod.
- The secret is included in `X-Telegram-Bot-Api-Secret-Token` on every callback. Telegram-end stored at `setWebhook` time.
- Our code compares it with `constantTimeEqual` (see `convex/lib/constantTimeEqual.ts`). Length-mismatch shortcut leaks length only, not bytes.
- Rotate by generating a new secret (`node scripts/new-webhook-secret.mjs`) + `npx convex env set TELEGRAM_WEBHOOK_SECRET=<new>` + `register-webhook` with the new value.

## chat_id allow-listing

V1 trusts the single configured chat. If your bot is in a private group with a known invite list, this is acceptable. If the bot is in a public channel or you need multi-tenant routing:

- Drop the `process.env.TELEGRAM_CHAT_ID` reliance.
- Add a `chats` table with allowed IDs.
- In the webhook, check `body.message.chat.id` against the table BEFORE dispatching.
- This is left as a v2 hardening exercise — the starter doesn't ship it because most adopters have a single private group.

## Constant-time compare rationale

Why `constantTimeEqual` and not `a === b`? See `convex/lib/constantTimeEqual.ts`. Short version: a naive byte-by-byte compare with early exit on first mismatch is a timing oracle — an attacker probing the secret can measure how long the comparison takes and learn one character at a time. The XOR-then-OR pattern runs in time proportional to length only.

The length-mismatch early-return DOES leak the expected length, but that's not meaningfully secret (the length is fixed at 64 hex chars by the secret generator).

## Bot token discipline

- `process.env.TELEGRAM_BOT_TOKEN` only. Never embed it in code, comments, or commits.
- Never `console.log` the token, even at debug level.
- Never return the token from a query/mutation/action.
- `verify-no-secrets` (pre-commit + CI) catches the standard token shape (`\d{8,12}:[A-Za-z0-9_-]{30,}`).

## Single-group invariant

The starter assumes ONE configured chat. If your bot lives in multiple chats:
- Per-chat commands won't be routed correctly (the env var holds one ID).
- Crons will post only to the configured chat.

Either narrow the bot to one chat OR refactor to a `chats` table + per-chat command/cron routing. V1 doesn't ship the latter.

## .gitignore enforcement

- `.env*` — never committed
- `.convex/` — Convex local cache; never committed
- `verify-no-secrets` scans the diff/full tree for the standard secret shapes:
  - Telegram bot token format
  - 64-hex webhook secret
  - Convex deployment URLs
  - `-100…` chat ID format

  See `scripts/verify-no-secrets.mjs`.
