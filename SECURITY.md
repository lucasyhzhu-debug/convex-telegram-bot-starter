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
| Attacker calls the public `admin*` registry functions | Reassign/archive chats, leak the chat list, test-send | `ADMIN_KEY` env var, constant-time compared, **fail-closed when unset** |
| Attacker steals the `ADMIN_KEY` | Full admin-surface control | Rotate the key (below); scope it to one deployment; never log it |
| Random chat `/register`s itself | Spam rows in `telegramChats` | Registration only records; routing requires an operator to assign a role |

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

## ADMIN_KEY — gating the v2 admin surface

The v2 self-registration registry exposes management functions in two forms (see
LESSON 14 and ARCHITECTURE.md):

- **`internal*`** — `internalQuery`/`internalMutation`/`internalAction`. Not
  publicly callable; reachable only from the Convex dashboard or `npx convex run`
  by someone who already has deployment access. No key needed.
- **`admin*`** — public `query`/`mutation`/`action` that back the bundled React
  admin app. These ARE reachable from the internet, so they're gated by
  `ADMIN_KEY`.

`requireAdminKey(provided)`:

- **Fails closed.** If `ADMIN_KEY` is unset, every `admin*` call throws — it
  refuses to run wide-open rather than defaulting to allow.
- **Constant-time compares** the provided key against the env value
  (`constantTimeEqual`), so an attacker can't probe it via timing.

### Generate & set

```bash
node scripts/new-webhook-secret.mjs          # 64 hex chars — same generator as the webhook secret
npx convex env set ADMIN_KEY=<the-secret>     # add --prod for production
```

The React app stores the key in `localStorage` and sends it with every admin
call. Treat it like a password: it's a bearer credential, not per-user identity.

### Rotate

```bash
node scripts/new-webhook-secret.mjs
npx convex env set ADMIN_KEY=<new-secret>          # dev
npx convex env set ADMIN_KEY=<new-secret> --prod   # prod (if separate)
```
Then re-enter the new key in the admin UI (clear the old one from `localStorage`).
Rotation is effectively instant — the next call validates against the new value.

### Replace the shim with real auth

`ADMIN_KEY` is a **minimum-viable shim** for a starter that has no users of its
own. A single shared bearer key has the usual weaknesses: no per-user audit, no
revocation short of rotating for everyone, and it lives in browser `localStorage`.

When you embed this in an app that already has authenticated users, **replace
`requireAdminKey` with your real auth** — a session token + `requireRole(ctx,
token, ["admin"])`, your existing permission check, etc. Only the `admin*`
wrappers change; the shared `…Impl` functions and the `internal*` twins stay as
they are. See `convex/telegram/chatRegistry.ts` (the `requireAdminKey` comment
points at this) and ARCHITECTURE.md § "Two management surfaces".

## chat_id allow-listing & multi-chat routing (now shipped in v2)

V1 trusted the single configured `TELEGRAM_CHAT_ID`. V2 ships the routing table
that section used to defer: a `telegramChats` registry where a chat only earns a
routing role after an operator assigns it one. Self-`/register` records a row but
grants nothing — routing is opt-in by an operator, so a random chat registering
itself can't redirect any feed.

If you additionally need to REJECT dispatch from unknown chats (e.g. a public
bot), check `body.message.chat.id` against the registry in the webhook before
dispatching — the `telegramChats` table is already the allow-list; the starter
just doesn't gate command dispatch on it by default (most adopters run private
groups).

## Constant-time compare rationale

Why `constantTimeEqual` and not `a === b`? See `convex/lib/constantTimeEqual.ts`. Short version: a naive byte-by-byte compare with early exit on first mismatch is a timing oracle — an attacker probing the secret can measure how long the comparison takes and learn one character at a time. The XOR-then-OR pattern runs in time proportional to length only.

The length-mismatch early-return DOES leak the expected length, but that's not meaningfully secret (the length is fixed at 64 hex chars by the secret generator).

## Bot token discipline

- `process.env.TELEGRAM_BOT_TOKEN` only. Never embed it in code, comments, or commits.
- Never `console.log` the token, even at debug level.
- Never return the token from a query/mutation/action.
- `verify-no-secrets` (pre-commit + CI) catches the standard token shape (`\d{8,12}:[A-Za-z0-9_-]{30,}`).

## Multi-chat routing (v2)

V1 assumed ONE configured chat. V2 removes that invariant: the `telegramChats`
registry routes any number of feeds to any number of groups by semantic role
(`getChatIdByRole`). The legacy single-chat env path still works during migration
via the `TELEGRAM_FALLBACK_ROLE` shim — see SELF-REGISTRATION.md § "Migration".
Once fully migrated, `npx convex env unset TELEGRAM_FALLBACK_ROLE` so the env path
can't shadow a registry assignment.

## .gitignore enforcement

- `.env*` — never committed
- `.convex/` — Convex local cache; never committed
- `verify-no-secrets` scans the diff/full tree for the standard secret shapes:
  - Telegram bot token format
  - 64-hex webhook secret
  - Convex deployment URLs
  - `-100…` chat ID format

  See `scripts/verify-no-secrets.mjs`.
