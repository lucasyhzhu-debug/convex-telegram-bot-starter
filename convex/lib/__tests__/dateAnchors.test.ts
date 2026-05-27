import { describe, it, expect } from "vitest";
import { noonLocalTodayMs } from "../dateAnchors";

describe("noonLocalTodayMs", () => {
  it("returns a UTC ms representing 12:00 local time in the given IANA timezone", () => {
    const ms = noonLocalTodayMs("Asia/Jakarta");
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
    expect(parts.hour).toBe("12");
    expect(parts.minute).toBe("00");
  });

  it("returns 12:00 local for a DST-having timezone too (America/New_York)", () => {
    const ms = noonLocalTodayMs("America/New_York");
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
    expect(parts.hour).toBe("12");
  });
});
