// convex/telegram/commands.ts

/**
 * Registration for a Telegram slash command. The webhook routes matched commands
 * to `dispatch`. Dispatch is async — the implementation typically schedules
 * an internalAction via `ctx.scheduler.runAfter(0, internal.X.Y, args)`, but
 * the registry is agnostic to that detail (only depends on a Promise return).
 */
export interface CommandRegistration {
  /** The command name WITHOUT the leading slash (e.g. "ping", "pack"). */
  name: string;
  /** Called when the command matches. Must not throw — wrap your runtime errors. */
  dispatch: () => Promise<void>;
}

export interface CommandMatch {
  command: CommandRegistration;
}

/**
 * Build a strict-mode command matcher. Returns a function that accepts the raw
 * message text and returns the matched command (or null). Strict mode = no
 * trailing args allowed; "/ping now" does NOT match the "ping" command. This
 * mirrors the Frollie pack-list bot's intentional choice (trailing args almost
 * always indicate user typos, not parameter intent — and v1 commands take no
 * parameters). If you want lenient matching in v2, swap the regex to a
 * head-only match (`^\\/${name}(@[A-Za-z0-9_]+)?\\b`).
 */
export function buildCommandMatcher(
  registrations: CommandRegistration[],
): (text: string) => CommandMatch | null {
  const compiled = registrations.map((c) => ({
    command: c,
    regex: new RegExp(`^\\/${escapeRegex(c.name)}(@[A-Za-z0-9_]+)?$`),
  }));
  return (text: string) => {
    const trimmed = text.trim();
    for (const { command, regex } of compiled) {
      if (regex.test(trimmed)) return { command };
    }
    return null;
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
