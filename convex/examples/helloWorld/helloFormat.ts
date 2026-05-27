// convex/examples/helloWorld/helloFormat.ts
import { chunkItems } from "../../lib/chunking";

export type HelloReason = "cron" | "command";

export interface HelloFormatInput {
  reason: HelloReason;
  /** UTC ms. Use Date.now() at the call site (passed in for test determinism). */
  generatedAt: number;
}

/**
 * Trivial formatter — uses chunkItems pedagogically (one chunk always fits)
 * so readers see the same pattern they'll use in pack-list.
 */
export function formatHello(input: HelloFormatInput): string[] {
  const title = input.reason === "cron" ? "Daily Hello" : "On-demand Hello";
  const iso = new Date(input.generatedAt).toISOString().replace("T", " ").slice(0, 16);
  const header = `👋 <b>${title}</b>`;
  const body = `Bot is alive — ${iso} UTC`;
  return chunkItems(header, [body]);
}
