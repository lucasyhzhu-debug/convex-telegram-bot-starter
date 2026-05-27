# pack-list

The real-world reference. Sanitized from Frollie's pack-list bot (PR #167) — same patterns, generic data.

## What it does

- **Daily morning cron** (00:00 UTC) → posts the list of orders to pack today
- **Daily midday reminder** (06:00 UTC) → posts the same list, headed "Still Pending"
- **`/pack` command** → posts on-demand, with the current time in the header

## Pattern (read in this order)

1. **Schema** — `convex/schema.ts` defines `orders` + `orderItems` (defined once in the OSS starter; no separate additions file)
2. **Query** — `packListQuery.ts`: status+dueDate index scan with post-collect undefined filter (Convex `.lte` includes undefined rows — see Lesson 1 in LESSONS.md)
3. **Formatter** — `packListFormat.ts`: render → HTML escape → sort → chunk via `convex/lib/chunking.ts`
4. **Action** — `sendPackList.ts`: env vars → query → format → `sendChunksWithBreadcrumb` (partial-send safety, I2 fix)
5. **Command + cron** — `buildPackListCommands(scheduler)` wired in `convex/http.ts`; cron entries in `convex/crons.ts`

## To run it

```bash
# Seed 3 demo orders
npx convex run examples/packList/seedData:resetDemoData

# On-demand
npx convex run examples/packList/sendPackList:sendPackList '{"reason":"command"}'
# Expect: pack list with 2 orders (third is future-dated)
```

Send `/pack` in your Telegram group — same output, but the header reads "Pack List (on-demand)".

## Configurable timezone

Set `PACK_LIST_TIMEZONE` env var to an IANA timezone (e.g. `Asia/Jakarta`, `America/New_York`). Default `UTC`. Affects:
- The header date (`Mon 27 May 2026 · 14:35`)
- The "end of today" cutoff for the dueDate filter

The cron schedules are in UTC — you choose what hour UTC you want them to fire at.

## Annotated non-obvious decisions

- **Post-collect filter for `dueDate`** — `withIndex("by_status_due_date", q => q.lte("dueDate", X))` includes rows where `dueDate` is `undefined`, because undefined sorts BEFORE numerics in an index. We filter `o.dueDate !== undefined` after `.collect()`. (Lesson 1.)
- **`isCancelled` filter on items** — orderItems can be soft-cancelled; we drop them before passing to the formatter.
- **Sort: expedited first** — rush orders bubble up regardless of dueDate.
- **R1 missing-address guard** — a delivery order with no address renders `Delivery → (no address — check order)` instead of silently rendering "Delivery". Surfaces data gaps visibly.
- **Chunking** — see `convex/lib/chunking.ts` and Lesson 3.
