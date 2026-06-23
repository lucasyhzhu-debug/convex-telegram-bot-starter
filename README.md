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
## Why this exists — the founder's story

I just co-founded a small FMCG business in Indonesia with my wife. I've started agentic engineering for all the business systems (it's so fun). 
For months the same question hit me every morning: *how many orders do we need to pack today?* The answer always existed in the admin dashboard, but getting it required: open laptop → wait for login → click into Orders → filter by date → count. By the time I had the number, I'd already lost the first 15 minutes of the day to a question that should have been one-glance.

Now my Telegram bot posts the pack list at 7am. I wake up, glance at my phone, and I already know what the day looks like — before coffee. If someone in the group asks "wait, is that current?", I type `/pack` and the bot re-posts the up-to-the-minute state on demand. No login. No dashboard. No "let me get back to you."

The unexpected win: my packing staff are in the same group. They see the same pack list at the same time I do. When the order count is high they're already mentally prepared before walking into the kitchen; when it's low they know the day is calmer. Nobody has to log into anything. Nobody has to ask anyone. **Accountability becomes ambient** — the information is just *there*, in the chat we were all going to be in anyway. The bot turned a daily friction into a shared morning ritual, and the cost was a few hours of plumbing.

That's the bot this starter is extracted from. The `packList` example is the sanitized version of exactly what I wake up to. If you've been waiting for the right shape of tool to push your operational data into your team's existing communication patterns, this is it.

## What's new in v2

v1 posted to a **single** hand-configured group (`TELEGRAM_CHAT_ID`). v2 adds
**self-registering multi-chat routing** — chats register themselves, you route
any number of feeds to any number of groups, and you can re-point a feed from a
UI with no redeploy.

```
/register@<bot>  →  assign a role in the admin UI  →  feeds route by role
```

- **Self-registration.** An operator adds the bot to a Telegram group and sends
  `/register@<bot>`. The bot captures it in a `telegramChats` table and replies
  with a link to the admin UI. No `curl …/getUpdates`, no env edits.
- **Role indirection.** Send-actions call `getChatIdByRole({ role })` at send
  time, so repointing a feed to a different group is a UI click — no code change.
- **React admin app.** Manage chats, assign roles, test-send, archive/restore at
  `/admin/telegram-chats`. Run it with `npm run dev:web` (Vite).
- **Cron resilience.** A `*Resilient` wrapper retries transient Convex
  capacity errors so a scheduled post isn't silently dropped.

The v1 single-chat path still works unchanged (the registry falls back to
`TELEGRAM_CHAT_ID` during migration). New here? Read
**[docs/SELF-REGISTRATION.md](docs/SELF-REGISTRATION.md)** for the walkthrough and
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the model.

## What's new in v3 — knowledge inbox + external brain

The same plumbing that posts ops digests turns out to be exactly what an
LLM-powered second brain needs: a place to **capture** things from your phone, a
**memory** of the conversation, and a way to **reply**. So this deployment
(`@LucasKnowledgeBot`) also serves as the transport + memory layer for an
external Claude Code agent called `wiki-brain` that maintains a personal markdown
wiki.

The split is deliberate:

> **Convex = transport + memory + Telegram I/O. The external agent = the intelligence.**

Convex can't run the LLM — so it doesn't try. It captures messages, queues them,
logs the conversation, and routes replies. A **local worker** polls the inbox and
runs the brain headlessly (`claude -p "/process-inbox"`); the brain ingests the
source (or answers the question) and posts the result back through
`POST /post-message`.

```
 You (Telegram)
     │  "https://… under recipes"   or   "what do I know about sourdough?"
     ▼
 POST /telegram-webhook
     │  dedupe (update_id) → classify save|ask → enqueue → instant ack
     ▼
 inbox table  (status: pending)
     │
     │  local worker:  listPending  →  claude -p "/process-inbox"
     ▼
 wiki-brain (external Claude Code agent)
     │  ingest source / answer question against the markdown wiki
     ▼
 POST /post-message   (X-Telegram-Bot-Api-Secret-Token)
     │  resolve chatId|role → sendTelegramHtml (chunked) → markDrained
     ▼
 You (Telegram)  ← summary / answer / daily digest
```

What capture does with your message:

- A **URL**, an `under <category>` prefix, or a `#tag` → **save** (filed to the
  wiki under that category; default category `inbox`).
- Plain prose / a question → **ask** (answered from the wiki).
- `save:` / `ask:` prefixes force the op. `youtube` links are detected as their
  own `kind`. Slash commands are never captured.

Alongside the inbox, every turn is logged to a `messages` table and grouped into
per-chat **threads** (a session window; idle 3 h opens a fresh one). The brain
reads `getSessionContext` so follow-up questions stay coherent, and `listSince`
for a weekly review. Send `/new` to start a fresh thread on demand.

| Surface | What it's for |
|---------|---------------|
| `POST /post-message` | external brain posts answers / summaries / digests back (secret-gated; `{html, chatId?\|role?}`) |
| `inbox.listPending` / `inbox.markDrained` | the drain worker's queue API (public, over the Convex `/api`) |
| `messages.getSessionContext` / `messages.listSince` | session context + weekly-review reads |
| `/new` command | reset the active thread |
| role `"brain"` | daily-digest destination |

The ops-digest examples (pack list, hello-world) still ship on disk — this
deployment just doesn't register them. See
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the table/intent/session model.

## What this is good for

Telegram bots are the cheapest, lowest-friction way to put your back-end into a team's chat. No app to build, no per-seat license, no extra dashboard for ops to log into. The message just lands in the group everyone already has open all day.

**Operational patterns this starter is built for:**

- **Daily ops digests** — yesterday's revenue, new orders, low-stock inventory, support queue length posted automatically every morning at 7am to the management group. Replaces the "did anyone look at the dashboard?" Slack thread.
- **Production / fulfillment progress** — pack-list for the day, orders stuck in transit, dispatch milestones, kitchen production counts. The bundled `packList` example is exactly this pattern, sanitized from a live FMCG ops bot.
- **Remote approvals without logging in** — instead of "open the admin panel to approve this PO", the manager reads the context in the chat (vendor, amount, line items), types `/approve 4521`, and the bot updates the backing system. No context switch. Works from a phone in a meeting, on a plane, at dinner.
- **Incident + deploy alerts** — error-rate spike, CI failure, deploy completed → pushed to the on-call channel with structured context. Cheaper than building an in-app notification center and more reliable than email.
- **Field-staff check-ins** — drivers reply `/delivered 0527-001` from their phone and the bot updates the order status. Warehouse staff `/restocked SKU-91`. No one needs admin-panel training; the command list IS the UI.
- **Executive KPI digests** — Friday-evening P&L summary, weekly customer-acquisition cost, monthly cohort retention chart — delivered to a 3-person executive group. On-demand pulls via `/kpi` when someone asks the question mid-meeting.
- **Customer / partner notifications** — order confirmed, dispatched, delivered → pushed to a customer-facing channel they already check. No email open-rate to worry about, no SMS-per-message bill.

**Why Telegram specifically** — free, group-chat semantics (multiple stakeholders see the same data simultaneously), push notifications without building an app, bot-first API (no human accounts needed for posting), works on any phone including the 9-year-old Android your warehouse manager is using, and your team already has it open.

**Why Convex specifically** — cron scheduling, HTTP routes, and a real-time type-safe DB in one serverless runtime. No separate scheduler service. No API gateway. No DevOps. The free tier comfortably fits a typical small-business bot's traffic, so "what does it cost to keep running?" has a satisfying answer (effectively zero at small scale).

For most CTOs evaluating "should we build this," the question isn't capability — almost any modern stack can post to Telegram. The question is **how much engineering time goes in, and how much ops surface area comes out**. This starter exists to compress the first to hours and keep the second to "one Convex dashboard and one Telegram group."



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
- `convex/inbox.ts` + `convex/inbox/capture.ts` — knowledge-inbox capture, classification (save/ask), and the public drain API (`listPending` / `markDrained`)
- `convex/messages.ts` — conversation log + thread sessions (`getSessionContext`, `listSince`)
- `convex/telegram/threadCommands.ts` — the `/new` reset-thread command
- `convex/examples/helloWorld/` — the 5-minute path (reference; not registered in this deployment)
- `convex/examples/packList/` — sanitized real-world reference, query → format → chunk → send (reference; not registered)
- `scripts/` — `verify-no-secrets`, `new-webhook-secret`, `register-webhook` (PowerShell-safe)
- `SETUP.md`, `SECURITY.md`, `RUNBOOK.md`, `LESSONS.md` — the playbook

## When to read what

- **Getting started:** `SETUP.md`
- **Stuck:** `RUNBOOK.md`
- **Hardening for production:** `SECURITY.md`
- **Why those weird patterns:** `LESSONS.md`

## License

MIT.
