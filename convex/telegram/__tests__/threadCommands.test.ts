// convex/telegram/__tests__/threadCommands.test.ts
//
// Tests for buildThreadCommands and the /new dispatch path.
// Uses the same pure-unit style as webhook.test.ts (no Convex runtime needed):
//   - The /new CommandRegistration is exercised via decideWebhookOutcome + buildCommandMatcher
//   - A scheduler mock captures runAfter calls so we can assert handleNew is scheduled

import { describe, it, expect, vi } from "vitest";
import { decideWebhookOutcome } from "../webhook";
import { buildCommandMatcher } from "../commands";
import { buildThreadCommands } from "../threadCommands";

const SECRET = "test-secret";

function makeScheduler() {
  const calls: Array<{ delay: number; fn: unknown; args: unknown }> = [];
  const scheduler = {
    runAfter: vi.fn(async (delay: number, fn: unknown, args: unknown) => {
      calls.push({ delay, fn, args });
    }),
    runAt: vi.fn(),
  };
  return { scheduler, calls };
}

function body(updateId: number, text?: string) {
  return {
    update_id: updateId,
    message: {
      ...(text !== undefined ? { text } : {}),
      chat: { id: -1001234567890, type: "supergroup", title: "Test Group" },
      from: { id: 99 },
    },
  };
}

describe("buildThreadCommands — /new registration", () => {
  it("registers a command named 'new'", () => {
    const { scheduler } = makeScheduler();
    const cmds = buildThreadCommands(scheduler as never);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].name).toBe("new");
  });

  it("/new is matched by buildCommandMatcher (bare)", () => {
    const { scheduler } = makeScheduler();
    const cmds = buildThreadCommands(scheduler as never);
    const match = buildCommandMatcher(cmds);
    expect(match("/new")).not.toBeNull();
  });

  it("/new@LucasKnowledgeBot is matched (bot-suffix form)", () => {
    const { scheduler } = makeScheduler();
    const cmds = buildThreadCommands(scheduler as never);
    const match = buildCommandMatcher(cmds);
    expect(match("/new@LucasKnowledgeBot")).not.toBeNull();
  });

  it("/new with trailing text is NOT matched (strict)", () => {
    const { scheduler } = makeScheduler();
    const cmds = buildThreadCommands(scheduler as never);
    const match = buildCommandMatcher(cmds);
    expect(match("/new something")).toBeNull();
  });
});

describe("/new dispatch via decideWebhookOutcome", () => {
  it("dispatches /new: schedules handleNew once with the correct chatId", async () => {
    const { scheduler, calls } = makeScheduler();
    const cmds = buildThreadCommands(scheduler as never);
    const match = buildCommandMatcher(cmds);

    await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: body(10, "/new"),
      deps: {
        recordIfNew: vi.fn().mockResolvedValue(true),
        match,
      },
    });

    // Dispatch schedules exactly one action (handleNew) that does reset+log+ack.
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);

    const [call] = calls;
    expect(call.delay).toBe(0);
    expect((call.args as Record<string, unknown>).chatId).toBe("-1001234567890");
    expect((call.args as Record<string, unknown>).text).toBe("/new");
  });

  it("returns 200 after /new dispatch", async () => {
    const { scheduler } = makeScheduler();
    const cmds = buildThreadCommands(scheduler as never);
    const match = buildCommandMatcher(cmds);

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: body(11, "/new"),
      deps: {
        recordIfNew: vi.fn().mockResolvedValue(true),
        match,
      },
    });

    expect(result.status).toBe(200);
  });

  it("dedupes /new — second delivery with same update_id is silently skipped", async () => {
    const { scheduler } = makeScheduler();
    const cmds = buildThreadCommands(scheduler as never);
    const match = buildCommandMatcher(cmds);

    await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: body(12, "/new"),
      deps: {
        recordIfNew: vi.fn().mockResolvedValue(false), // already seen
        match,
      },
    });

    // No scheduling should occur on duplicate delivery
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("still returns 200 on duplicate /new delivery", async () => {
    const { scheduler } = makeScheduler();
    const cmds = buildThreadCommands(scheduler as never);
    const match = buildCommandMatcher(cmds);

    const result = await decideWebhookOutcome({
      providedSecret: SECRET,
      expectedSecret: SECRET,
      body: body(13, "/new"),
      deps: {
        recordIfNew: vi.fn().mockResolvedValue(false),
        match,
      },
    });

    expect(result.status).toBe(200);
  });
});
