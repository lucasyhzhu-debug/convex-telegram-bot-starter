// Tests the partial-send breadcrumb logic in isolation. We extract a thin
// helper `sendChunksWithBreadcrumb` for testability — the action itself
// stays a thin Convex wrapper around it.

import { describe, it, expect, vi } from "vitest";
import { sendChunksWithBreadcrumb } from "../sendPackList";

describe("sendChunksWithBreadcrumb (I2 partial-send breadcrumb)", () => {
  it("sends all chunks when none fail", async () => {
    const send = vi.fn().mockResolvedValue({ message_id: 1 });
    await sendChunksWithBreadcrumb(["a", "b", "c"], send);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("on mid-send failure: throws AND sends a breadcrumb warning chunk to the same chat", async () => {
    let n = 0;
    const send = vi.fn().mockImplementation(async () => {
      n++;
      if (n === 2) throw new Error("network");
      return { message_id: n };
    });
    await expect(sendChunksWithBreadcrumb(["a", "b", "c"], send)).rejects.toThrow("network");
    // 1st chunk + 1 attempted 2nd + 1 breadcrumb = 3 calls
    expect(send).toHaveBeenCalledTimes(3);
    const lastCall = send.mock.calls[2]?.[0] as string;
    expect(lastCall).toContain("send failed after 1/3 chunks");
  });
});
