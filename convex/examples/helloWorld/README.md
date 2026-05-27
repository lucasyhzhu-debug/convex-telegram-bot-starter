# hello-world

The 5-minute path. If this works, your setup is correct.

## What it does

- **Daily cron at 12:00 UTC** → posts "👋 Daily Hello" to your configured Telegram chat
- **`/ping` command** in the chat → posts "👋 On-demand Hello"

## What to read

- `helloFormat.ts` — pedagogical formatter; routes through `chunkItems` so you see the pattern you'll use in pack-list
- `sendHello.ts` — internalAction; reads env vars, calls formatter, sends. Registers the `/ping` command via `buildHelloWorldCommands`.

## How to run it

After completing `SETUP.md`:

```bash
npx convex run examples/helloWorld/sendHello:sendHello '{"reason":"command"}'
# Expect: "👋 On-demand Hello" arrives in your group within ~2s
```

Send `/ping` in the group → same message.

## Next steps

When hello-world works, read `convex/examples/packList/` for the real-world pattern (query → format → chunk → send).
