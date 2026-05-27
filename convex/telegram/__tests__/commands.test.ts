import { describe, it, expect, vi } from "vitest";
import { buildCommandMatcher, type CommandRegistration } from "../commands";

function reg(name: string): CommandRegistration {
  return { name, dispatch: vi.fn().mockResolvedValue(undefined) };
}

describe("buildCommandMatcher", () => {
  it("returns null match for an empty registry", async () => {
    const matcher = buildCommandMatcher([]);
    const result = matcher("/anything");
    expect(result).toBeNull();
  });

  it("matches /name and /name@BotUsername exactly", async () => {
    const ping = reg("ping");
    const matcher = buildCommandMatcher([ping]);
    expect(matcher("/ping")?.command.name).toBe("ping");
    expect(matcher("/ping@MyBot")?.command.name).toBe("ping");
    expect(matcher("/ping@_under_score_bot")?.command.name).toBe("ping");
  });

  it("does NOT match commands with trailing args (strict mode)", () => {
    const ping = reg("ping");
    const matcher = buildCommandMatcher([ping]);
    expect(matcher("/ping now")).toBeNull();
    expect(matcher("ping")).toBeNull();
    expect(matcher("/ping@MyBot extra")).toBeNull();
  });

  it("dispatches in registration order — first match wins", () => {
    const a = reg("a");
    const b = reg("a"); // same name (would be a bug, but tests precedence)
    const matcher = buildCommandMatcher([a, b]);
    const m = matcher("/a");
    expect(m?.command).toBe(a);
    expect(m?.command).not.toBe(b);
  });
});
