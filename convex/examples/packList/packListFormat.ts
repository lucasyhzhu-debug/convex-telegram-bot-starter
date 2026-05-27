// convex/examples/packList/packListFormat.ts
import { escapeHtml } from "../../lib/telegramHtml";
import { chunkItems } from "../../lib/chunking";

export type FormatReason = "morning" | "midday" | "command";

export interface PackOrderItem {
  productName: string;
  quantity: number;
}

export interface PackOrder {
  orderNumber: string;
  customerName: string;
  items: PackOrderItem[];
  deliveryType: "delivery" | "pickup";
  deliveryAddress?: string;
  notes?: string;
  expedited?: boolean;
  dueDate?: number;
}

export interface FormatInput {
  reason: FormatReason;
  orders: PackOrder[];
  counts: { total: number; delivery: number; pickup: number };
  /** UTC ms — pass Date.now() at call site. */
  generatedAt: number;
  /** IANA timezone for header date formatting. Default UTC. Example: "Asia/Jakarta". */
  timeZone?: string;
}

function localParts(utcMs: number, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map(p => [p.type, p.value]));
  return {
    weekday: parts.weekday ?? "",
    day: parts.day ?? "",
    month: parts.month ?? "",
    year: parts.year ?? "",
    hh: parts.hour ?? "00",
    mm: parts.minute ?? "00",
  };
}

function buildHeader(input: FormatInput, isEmpty: boolean): string {
  const p = localParts(input.generatedAt, input.timeZone ?? "UTC");
  const dateStr = `${p.weekday} ${p.day} ${p.month} ${p.year}`;
  let title: string;
  if (input.reason === "morning") title = `<b>Pack List — ${dateStr}</b>`;
  else if (input.reason === "midday") title = `<b>Still Pending — ${dateStr} · ${p.hh}:${p.mm}</b>`;
  else title = `<b>Pack List (on-demand) — ${dateStr} · ${p.hh}:${p.mm}</b>`;
  if (isEmpty) return `${title}\n\nNothing to pack today. ✅`;
  const label = input.reason === "midday" ? "orders not yet shipped" : "orders to pack today";
  return `${title}\n\n${input.counts.total} ${label} · ${input.counts.delivery} delivery · ${input.counts.pickup} pickup`;
}

function renderOrder(o: PackOrder): string {
  const lines: string[] = [];
  const rush = o.expedited ? "  [rush]" : "";
  lines.push(`<b>${escapeHtml(o.orderNumber)}</b> — ${escapeHtml(o.customerName)}${rush}`);
  for (const it of o.items) lines.push(`  ${it.quantity}× ${escapeHtml(it.productName)}`);
  if (o.deliveryType === "delivery") {
    const addr = o.deliveryAddress && o.deliveryAddress.trim().length > 0
      ? escapeHtml(o.deliveryAddress)
      : "(no address — check order)";
    lines.push(`  Delivery → ${addr}`);
  } else {
    lines.push(`  Pickup`);
  }
  if (o.notes && o.notes.trim().length > 0) lines.push(`  📝 ${escapeHtml(o.notes)}`);
  return lines.join("\n");
}

export function formatPackList(input: FormatInput): string[] {
  const isEmpty = input.orders.length === 0;
  const header = buildHeader(input, isEmpty);
  if (isEmpty) return [header];

  const sorted = [...input.orders].sort((a, b) => {
    const ea = a.expedited ? 0 : 1;
    const eb = b.expedited ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity);
  });
  const rendered = sorted.map(renderOrder);
  return chunkItems(header, rendered, {
    continuationHeader: (i) => `<i>…continued (${i + 1})</i>`,
  });
}
