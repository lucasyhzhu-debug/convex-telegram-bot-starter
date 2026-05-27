// convex/lib/dateAnchors.ts

/**
 * Returns the UTC ms timestamp for 12:00 (noon) TODAY in the given IANA timezone.
 *
 * Use as a test clock anchor. Pinning to noon gives you 12h margin in either
 * direction from local midnight, eliminating the latent flake where a test
 * computes "today" / "yesterday" and CI happens to run near 00:00 local.
 *
 * Usage:
 *   const t = convexTest(schema, modules);
 *   const NOW = noonLocalTodayMs("Asia/Jakarta");
 *   await t.query(api.foo.getBar, { now: NOW });
 */
export function noonLocalTodayMs(timeZone: string): number {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);

  // Compute UTC ms for "12:00 local" by guessing and correcting via the offset
  // at that instant. Adequate for non-DST-transition days (the noon anchor
  // intentionally avoids the 02:00–03:00 transition window).
  const utcGuess = Date.UTC(y, m - 1, d, 12, 0, 0, 0);
  const tzFmt = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" });
  const offsetPart = tzFmt.formatToParts(new Date(utcGuess)).find(p => p.type === "timeZoneName")?.value ?? "GMT";
  const match = offsetPart.match(/GMT([+-]\d+)(?::(\d+))?/);
  const hours = match ? parseInt(match[1]!, 10) : 0;
  const mins = match && match[2] ? parseInt(match[2], 10) * Math.sign(hours || 1) : 0;
  return utcGuess - (hours * 60 + mins) * 60_000;
}
