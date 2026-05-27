# Telegram Webhook Internals

This directory hosts the inbound side of the bot: dedupe, command parsing, dispatch.

## The shape

- `commands.ts` — `buildCommandMatcher([{ name, dispatch }, ...])` returns a strict-mode regex matcher
- `webhook.ts` — `decideWebhookOutcome` (pure, unit-testable), `recordIfNew` (atomic mutation), `buildHandleTelegramWebhook` (factory: takes registrations, returns the httpAction)

## The pattern (WebhookDeps)

`decideWebhookOutcome` accepts a `deps` object with `recordIfNew` and `match`. In tests, you pass plain async functions. In production, `buildHandleTelegramWebhook` wires `ctx.runMutation` and the command matcher. This split lets you unit-test the entire control flow without spinning up convex-test.

## Three load-bearing decisions

1. **Atomic recordIfNew (R5)** — read-then-write was originally two operations; concurrent retries from Telegram could both insert. Collapsed to a single mutation so Convex's serialization guarantees us mutual exclusion.
2. **200-on-dispatch-error (C3)** — once the dedupe row is committed, returning 500 would have Telegram retry; the retry would see the row exists and skip; you get a permanent 500-retry loop for ~24h. Log and ACK 200 instead.
3. **Strict command match** — `/pack now please` does NOT match the "pack" command. In v1, commands take no args, and trailing tokens are almost always typos.
