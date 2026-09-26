import { describe, expect, it, vi } from "vitest";

import { SourceRefreshScheduler } from "./scheduler";
import { deferred } from "../test/deferred";

describe("SourceRefreshScheduler", () => {
  it("drains an active refresh before stopping and skips the next source", async () => {
    const pending = deferred<never>();
    const refresh = vi.fn(() => pending.promise);
    const scheduler = new SourceRefreshScheduler({
      listDueForAutoRefresh: () => [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      refresh,
    });
    const run = scheduler.runDue();
    let stopped = false;
    const stop = scheduler.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    pending.reject(new Error("failed"));
    await Promise.all([run, stop]);
    expect(stopped).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("contains scan errors rather than producing unhandled rejections", async () => {
    const scheduler = new SourceRefreshScheduler({
      listDueForAutoRefresh: () => {
        throw new Error("database unavailable");
      },
      refresh: vi.fn(),
    });
    await expect(scheduler.runDue()).resolves.toBeUndefined();
    await scheduler.stop();
  });
  it("refreshes every due source and continues after a failure", async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({
        source: { proxiesCount: 2 },
      })
      .mockRejectedValueOnce(new Error("refresh failed"));
    const record = vi.fn();
    const scheduler = new SourceRefreshScheduler(
      {
        listDueForAutoRefresh: () => [
          { id: "due-1", name: "First" },
          { id: "due-2", name: "Second" },
        ],
        refresh,
      },
      { record } as never,
    );

    await scheduler.runDue(new Date("2026-06-15T00:00:00.000Z"));

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "source.auto-refresh" }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "source.auto-refresh",
        level: "error",
      }),
    );
  });
});
