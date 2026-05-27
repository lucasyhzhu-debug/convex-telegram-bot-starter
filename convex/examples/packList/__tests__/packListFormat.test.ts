import { describe, it, expect } from "vitest";
import { formatPackList, type PackOrder } from "../packListFormat";

const T = Date.parse("2026-05-27T05:00:00Z"); // 12:00 in Jakarta (UTC+7)

function ord(overrides: Partial<PackOrder> = {}): PackOrder {
  return {
    orderNumber: "0527-001",
    customerName: "Customer A",
    items: [{ productName: "Product A", quantity: 2 }],
    deliveryType: "delivery",
    deliveryAddress: "123 Maple Street",
    ...overrides,
  };
}

describe("formatPackList", () => {
  it("empty orders → single chunk with 'Nothing to pack today'", () => {
    const out = formatPackList({
      reason: "morning", orders: [], counts: { total: 0, delivery: 0, pickup: 0 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Nothing to pack today");
  });

  it("morning header uses 'Pack List' prefix and the local date", () => {
    const out = formatPackList({
      reason: "morning", orders: [ord()], counts: { total: 1, delivery: 1, pickup: 0 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    expect(out[0]).toContain("Pack List");
    expect(out[0]).toContain("27 May 2026");
  });

  it("midday header reads 'Still Pending' + the local time", () => {
    const out = formatPackList({
      reason: "midday", orders: [ord()], counts: { total: 1, delivery: 1, pickup: 0 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    expect(out[0]).toContain("Still Pending");
    expect(out[0]).toMatch(/12:00/);
  });

  it("command header reads 'Pack List (on-demand)' + time", () => {
    const out = formatPackList({
      reason: "command", orders: [ord()], counts: { total: 1, delivery: 1, pickup: 0 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    expect(out[0]).toContain("Pack List (on-demand)");
    expect(out[0]).toMatch(/12:00/);
  });

  it("morning summary line uses 'orders to pack today'", () => {
    const out = formatPackList({
      reason: "morning", orders: [ord()], counts: { total: 5, delivery: 3, pickup: 2 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    expect(out[0]).toContain("5 orders to pack today · 3 delivery · 2 pickup");
  });

  it("midday summary line uses 'orders not yet shipped'", () => {
    const out = formatPackList({
      reason: "midday", orders: [ord()], counts: { total: 4, delivery: 2, pickup: 2 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    expect(out[0]).toContain("4 orders not yet shipped · 2 delivery · 2 pickup");
  });

  it("renders each order with bold orderNumber, customer name, items, and delivery address", () => {
    const out = formatPackList({
      reason: "morning",
      orders: [ord({ items: [{ productName: "Product A", quantity: 3 }] })],
      counts: { total: 1, delivery: 1, pickup: 0 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    expect(out[0]).toContain("<b>0527-001</b>");
    expect(out[0]).toContain("Customer A");
    expect(out[0]).toContain("3× Product A");
    expect(out[0]).toContain("Delivery → 123 Maple Street");
  });

  it("pickup orders show 'Pickup' (not 'Delivery')", () => {
    const out = formatPackList({
      reason: "morning",
      orders: [ord({ deliveryType: "pickup", deliveryAddress: undefined })],
      counts: { total: 1, delivery: 0, pickup: 1 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    expect(out[0]).toContain("Pickup");
    expect(out[0]).not.toMatch(/Delivery →/);
  });

  it("R1: delivery order with empty/whitespace address shows '(no address — check order)'", () => {
    const out = formatPackList({
      reason: "morning",
      orders: [ord({ deliveryAddress: "  " })],
      counts: { total: 1, delivery: 1, pickup: 0 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    expect(out[0]).toContain("(no address — check order)");
  });

  it("notes are rendered with the 📝 marker; missing notes are omitted", () => {
    const withNotes = formatPackList({
      reason: "morning",
      orders: [ord({ notes: "Ring buzzer 4B" })],
      counts: { total: 1, delivery: 1, pickup: 0 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    expect(withNotes[0]).toContain("📝 Ring buzzer 4B");

    const noNotes = formatPackList({
      reason: "morning",
      orders: [ord()],
      counts: { total: 1, delivery: 1, pickup: 0 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    expect(noNotes[0]).not.toContain("📝");
  });

  it("expedited orders are tagged [rush] in the header line", () => {
    const out = formatPackList({
      reason: "morning",
      orders: [ord({ expedited: true })],
      counts: { total: 1, delivery: 1, pickup: 0 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    expect(out[0]).toContain("[rush]");
  });

  it("expedited orders sort BEFORE non-expedited, regardless of dueDate", () => {
    const a: PackOrder = ord({ orderNumber: "A-NORMAL", customerName: "A", expedited: false, dueDate: T - 1000 });
    const b: PackOrder = ord({ orderNumber: "B-RUSH", customerName: "B", expedited: true, dueDate: T + 1000 });
    const out = formatPackList({
      reason: "morning", orders: [a, b],
      counts: { total: 2, delivery: 2, pickup: 0 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    const idxRush = out[0]!.indexOf("B-RUSH");
    const idxNormal = out[0]!.indexOf("A-NORMAL");
    expect(idxRush).toBeGreaterThan(-1);
    expect(idxNormal).toBeGreaterThan(-1);
    expect(idxRush).toBeLessThan(idxNormal);
  });

  it("among same-priority orders, earlier dueDate sorts first", () => {
    const a: PackOrder = ord({ orderNumber: "LATER", dueDate: T + 5000 });
    const b: PackOrder = ord({ orderNumber: "EARLIER", dueDate: T + 1000 });
    const out = formatPackList({
      reason: "morning", orders: [a, b],
      counts: { total: 2, delivery: 2, pickup: 0 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    const idxEarlier = out[0]!.indexOf("EARLIER");
    const idxLater = out[0]!.indexOf("LATER");
    expect(idxEarlier).toBeLessThan(idxLater);
  });

  it("HTML-escapes customer names and product names (Bobby <Tables>)", () => {
    const out = formatPackList({
      reason: "morning",
      orders: [ord({
        customerName: "Bobby <Tables>",
        items: [{ productName: "Combo & Snack", quantity: 1 }],
      })],
      counts: { total: 1, delivery: 1, pickup: 0 },
      generatedAt: T, timeZone: "Asia/Jakarta",
    });
    expect(out[0]).toContain("Bobby &lt;Tables&gt;");
    expect(out[0]).toContain("Combo &amp; Snack");
    expect(out[0]).not.toContain("<Tables>");
  });
});
