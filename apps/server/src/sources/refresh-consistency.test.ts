import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/env";
import { initializeDatabase } from "../db/database";
import type { RemoteFetcher } from "../remote/fetch-subscription";
import { SourceRepository } from "./repository";
import { SourceService } from "./service";
import { deferred } from "../test/deferred";

const databases: ReturnType<typeof initializeDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function setup(fetcher: RemoteFetcher) {
  const database = initializeDatabase(":memory:");
  databases.push(database);
  const repository = new SourceRepository(database);
  const service = new SourceService(
    repository,
    loadConfig({
      NODE_ENV: "test",
      SESSION_SECRET: "refresh-consistency-secret-longer-than-32",
    }),
    fetcher,
  );
  const source = service.create({
    name: "Source",
    type: "remote_url",
    url: "https://example.com/old",
  });
  return { database, repository, service, source };
}

describe("remote refresh consistency", () => {
  it("shares concurrent refreshes and retains only the latest successful cache", async () => {
    const pending = deferred<string>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue("proxies: []\n# second");
    const { service, source, database, repository } = setup(fetcher);
    const first = service.refresh(source.id);
    const second = service.refresh(source.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    pending.resolve("proxies: []\n# first");
    await Promise.all([first, second]);
    await service.refresh(source.id);
    expect(repository.findLatestCache(source.id)?.content).toContain("second");
    expect(
      database.sqlite
        .prepare("SELECT count(*) AS count FROM subscription_cache")
        .get(),
    ).toEqual({ count: 1 });
  });

  it("invalidates old cache on URL changes and discards in-flight stale results", async () => {
    const pending = deferred<string>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("proxies: []")
      .mockReturnValueOnce(pending.promise);
    const { service, source, repository } = setup(fetcher);
    await service.refresh(source.id);
    const refresh = service.refresh(source.id);
    service.update(source.id, { url: "https://example.com/new" });
    pending.resolve("proxies: []\n# stale");
    await expect(refresh).rejects.toThrow(/Source changed/);
    expect(repository.findLatestCache(source.id)).toBeUndefined();
    expect(service.get(source.id)?.lastFetchStatus).toBe("never");
  });

  it("does not resurrect a deleted source when a refresh completes", async () => {
    const pending = deferred<string>();
    const { service, source, repository } = setup(() => pending.promise);
    const refresh = service.refresh(source.id);
    service.delete(source.id);
    pending.resolve("proxies: []");
    expect(await refresh).toBeUndefined();
    expect(repository.findLatestCache(source.id)).toBeUndefined();
  });

  it("keeps the previous cache when a new response cannot be parsed", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("proxies: []")
      .mockResolvedValueOnce("password: [sensitive-value");
    const { service, source, repository } = setup(fetcher);
    await service.refresh(source.id);
    await expect(service.refresh(source.id)).rejects.toThrow(/Invalid YAML/);
    expect(repository.findLatestCache(source.id)?.content).toBe("proxies: []");
    expect(service.get(source.id)?.lastFetchStatus).toBe("failed");
    expect(service.get(source.id)?.lastError).not.toContain("sensitive-value");
  });

  it("rolls back cache replacement if writing source metadata fails", async () => {
    const { service, source, database, repository } = setup(
      async () => "proxies: []",
    );
    await service.refresh(source.id);
    const oldCache = repository.findLatestCache(source.id)!;
    database.sqlite.exec(
      "CREATE TRIGGER reject_refresh BEFORE UPDATE ON subscription_sources BEGIN SELECT RAISE(ABORT, 'write failed'); END;",
    );
    await expect(service.refresh(source.id)).rejects.toThrow();
    expect(repository.findLatestCache(source.id)?.id).toBe(oldCache.id);
  });
});
