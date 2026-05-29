import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { parseCommand } from "../chatRegistry";

// ─── PART A: parseCommand (pure) ─────────────────────────────────────────────
//
// parseCommand only knows the two registry built-ins (/register, /start). It
// accepts an optional @BotName suffix and surrounding whitespace, and rejects
// trailing args (typo protection). Feature commands like /pack are matched
// elsewhere (commands.ts), so parseCommand returns null for them.

describe("parseCommand", () => {
  it("/register → 'register'", () => {
    expect(parseCommand("/register")).toBe("register");
  });

  it("/start → 'start'", () => {
    expect(parseCommand("/start")).toBe("start");
  });

  it("/register@SomeBot → 'register'", () => {
    expect(parseCommand("/register@SomeBot")).toBe("register");
  });

  it("surrounding whitespace still matches", () => {
    expect(parseCommand("  /register  ")).toBe("register");
    expect(parseCommand("\t/start\n")).toBe("start");
  });

  it("/pack → null (not a registry built-in)", () => {
    expect(parseCommand("/pack")).toBeNull();
  });

  it("/register with trailing args → null", () => {
    expect(parseCommand("/register now")).toBeNull();
  });

  it("plain text 'hello' → null", () => {
    expect(parseCommand("hello")).toBeNull();
  });

  it("/registerx (no boundary) → null", () => {
    expect(parseCommand("/registerx")).toBeNull();
  });
});

// ─── PART B: registry mechanics via convex-test ──────────────────────────────
//
// KNOWN_TELEGRAM_ROLES is EMPTY in the shipped config, so every role-validated
// path (assignRole, seedFromEnvWrite) rejects all roles via assertKnownRole. To
// exercise lookup + lifecycle mechanics we seed rows AND role fields directly via
// t.run (raw db access, bypassing the allowlist). The allowlist guard itself is
// asserted separately (it throws on unknown roles).

const NOW = 1_700_000_000_000;

/** Seed an active telegramChats row directly, optionally with a role. */
async function seedRow(
  t: ReturnType<typeof convexTest>,
  opts: { chatId: string; role?: string; archivedAt?: number; title?: string },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("telegramChats", {
      chatId: opts.chatId,
      chatType: "supergroup" as const,
      title: opts.title ?? `Chat ${opts.chatId}`,
      role: opts.role,
      registeredAt: NOW,
      lastSeenAt: NOW,
      archivedAt: opts.archivedAt,
    });
  });
}

describe("getChatIdByRole lookup chain", () => {
  it("returns chatId of an active row matching the role", async () => {
    const t = convexTest(schema);
    await seedRow(t, { chatId: "-100111", role: "alerts" });
    const chatId = await t.query(
      internal.telegram.chatRegistry.getChatIdByRole,
      { role: "alerts" },
    );
    expect(chatId).toBe("-100111");
  });

  it("throws when no row and no env fallback", async () => {
    const t = convexTest(schema);
    await expect(
      t.query(internal.telegram.chatRegistry.getChatIdByRole, {
        role: "alerts",
      }),
    ).rejects.toThrow(/No Telegram chat assigned to role 'alerts'/);
  });

  it("falls back to TELEGRAM_CHAT_ID when env role matches and no row exists", async () => {
    vi.stubEnv("TELEGRAM_FALLBACK_ROLE", "alerts");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100999");
    try {
      const t = convexTest(schema);
      const chatId = await t.query(
        internal.telegram.chatRegistry.getChatIdByRole,
        { role: "alerts" },
      );
      expect(chatId).toBe("-100999");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("prefers an active table row over the env fallback", async () => {
    vi.stubEnv("TELEGRAM_FALLBACK_ROLE", "alerts");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100999");
    try {
      const t = convexTest(schema);
      await seedRow(t, { chatId: "-100111", role: "alerts" });
      const chatId = await t.query(
        internal.telegram.chatRegistry.getChatIdByRole,
        { role: "alerts" },
      );
      expect(chatId).toBe("-100111");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("role uniqueness / slot freeing", () => {
  it("getChatIdByRole resolves to the active holder; archiving frees the slot", async () => {
    const t = convexTest(schema);
    await seedRow(t, { chatId: "-100AAA", role: "x" });
    await seedRow(t, { chatId: "-100BBB" }); // dormant, no role

    // First holder resolves.
    expect(
      await t.query(internal.telegram.chatRegistry.getChatIdByRole, {
        role: "x",
      }),
    ).toBe("-100AAA");

    // Archive the holder → role slot frees → lookup now throws (no other holder).
    await t.mutation(internal.telegram.chatRegistry.archiveChat, {
      chatId: "-100AAA",
    });
    await expect(
      t.query(internal.telegram.chatRegistry.getChatIdByRole, { role: "x" }),
    ).rejects.toThrow(/No Telegram chat assigned to role 'x'/);
  });
});

describe("archiveChat", () => {
  it("sets archivedAt, clears role, and frees the role slot", async () => {
    const t = convexTest(schema);
    await seedRow(t, { chatId: "-100ARC", role: "alerts" });

    await t.mutation(internal.telegram.chatRegistry.archiveChat, {
      chatId: "-100ARC",
    });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("telegramChats")
        .withIndex("by_chatId", (q) => q.eq("chatId", "-100ARC"))
        .unique(),
    );
    expect(row?.archivedAt).toEqual(expect.any(Number));
    expect(row?.role).toBeUndefined();

    await expect(
      t.query(internal.telegram.chatRegistry.getChatIdByRole, {
        role: "alerts",
      }),
    ).rejects.toThrow();
  });
});

describe("restoreChat", () => {
  it("clears archivedAt", async () => {
    const t = convexTest(schema);
    await seedRow(t, { chatId: "-100RES", archivedAt: NOW });

    await t.mutation(internal.telegram.chatRegistry.restoreChat, {
      chatId: "-100RES",
    });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("telegramChats")
        .withIndex("by_chatId", (q) => q.eq("chatId", "-100RES"))
        .unique(),
    );
    expect(row?.archivedAt).toBeUndefined();
  });
});

describe("touchChatLastSeen", () => {
  it("is a no-op on an unknown chatId (no insert)", async () => {
    const t = convexTest(schema);
    await t.mutation(internal.telegram.chatRegistry.touchChatLastSeen, {
      chatId: "-100UNKNOWN",
    });
    const all = await t.run(async (ctx) =>
      ctx.db.query("telegramChats").collect(),
    );
    expect(all).toHaveLength(0);
  });

  it("updates lastSeenAt on an existing active row", async () => {
    const t = convexTest(schema);
    const id = await seedRow(t, { chatId: "-100TOUCH" });

    await t.mutation(internal.telegram.chatRegistry.touchChatLastSeen, {
      chatId: "-100TOUCH",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.lastSeenAt).toBeGreaterThan(NOW);
  });

  it("is a no-op on an archived row", async () => {
    const t = convexTest(schema);
    const id = await seedRow(t, { chatId: "-100ARCH", archivedAt: NOW });

    await t.mutation(internal.telegram.chatRegistry.touchChatLastSeen, {
      chatId: "-100ARCH",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.lastSeenAt).toBe(NOW); // unchanged
  });
});

describe("upsertChatRow three states", () => {
  const args = {
    chatType: "supergroup" as const,
    title: "Upsert Group",
    registeredBy: 7,
  };

  it("none → inserted", async () => {
    const t = convexTest(schema);
    const res = await t.mutation(
      internal.telegram.chatRegistry.upsertChatRow,
      { chatId: "-100UP1", ...args },
    );
    expect(res).toEqual({ status: "inserted" });
  });

  it("existing-no-role → dormant", async () => {
    const t = convexTest(schema);
    await seedRow(t, { chatId: "-100UP2" }); // no role
    const res = await t.mutation(
      internal.telegram.chatRegistry.upsertChatRow,
      { chatId: "-100UP2", ...args },
    );
    expect(res).toEqual({ status: "dormant" });
  });

  it("existing-with-role → live", async () => {
    const t = convexTest(schema);
    await seedRow(t, { chatId: "-100UP3", role: "alerts" });
    const res = await t.mutation(
      internal.telegram.chatRegistry.upsertChatRow,
      { chatId: "-100UP3", ...args },
    );
    expect(res).toEqual({ status: "live", role: "alerts" });
  });
});

describe("seedFromEnvWrite allowlist guard", () => {
  it("throws 'Unknown telegram role' for any role (KNOWN_TELEGRAM_ROLES is empty)", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(internal.telegram.chatRegistry.seedFromEnvWrite, {
        chatId: "-100SEED",
        chatType: "supergroup",
        title: "Seed Group",
        role: "anything",
      }),
    ).rejects.toThrow(/Unknown telegram role/);
  });
});
