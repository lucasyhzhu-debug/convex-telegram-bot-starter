# convex-telegram-bot-starter

> Daily-message + slash-command Telegram bot for your Convex app. Production-tested patterns, 60+ tests, MIT-licensed.

```
   Telegram → POST /telegram-webhook
             ↓
        recordIfNew (atomic dedupe)
             ↓
        scheduler.runAfter(0, ...)
             ↓
        internalAction → sendTelegramHtml → Telegram
```

## Try it locally in 5 minutes

1. `gh repo clone lucasyhzhu-debug/convex-telegram-bot-starter && cd convex-telegram-bot-starter`
2. `npm install`
3. `cp .env.example .env.local` — leave blank for now
4. `npx convex dev --once --configure new` — create a fresh dev deployment
5. Follow `SETUP.md` steps 1–8 to get your bot token + chat ID + webhook secret

You'll have hello-world running in your Telegram group at the end of step 8.

## What's in the box

- `convex/lib/` — `telegramHtml`, `chunking`, `constantTimeEqual`, `dateAnchors` (defensive utilities, fully tested)
- `convex/telegram/` — `webhook` (pure-core + httpAction factory), `commands` (strict-mode registry)
- `convex/examples/helloWorld/` — the 5-minute path
- `convex/examples/packList/` — sanitized real-world reference (query → format → chunk → send)
- `scripts/` — `verify-no-secrets`, `new-webhook-secret`, `register-webhook` (PowerShell-safe)
- `SETUP.md`, `SECURITY.md`, `RUNBOOK.md`, `LESSONS.md` — the playbook

## When to read what

- **Getting started:** `SETUP.md`
- **Stuck:** `RUNBOOK.md`
- **Hardening for production:** `SECURITY.md`
- **Why those weird patterns:** `LESSONS.md`

## License

MIT.
