import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../app";
import { loadConfig } from "../config/env";
import { sessionCookieName } from "../auth/session";
import { SourceRepository } from "./repository";
import { SourceService } from "./service";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
const config = loadConfig({
  NODE_ENV: "test",
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "correct-password",
  SESSION_SECRET: "test-session-secret-that-is-longer-than-32-chars",
  DATABASE_URL: ":memory:",
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createAuthenticatedApp() {
  const app = await createApp({ config, logger: false });
  apps.push(app);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "correct-password" },
  });
  const cookie = login.cookies.find((item) => item.name === sessionCookieName)!;
  return { app, cookies: { [sessionCookieName]: cookie.value } };
}

describe("subscription source CRUD", () => {
  it("creates remote and pasted sources without exposing the remote token", async () => {
    const { app, cookies } = await createAuthenticatedApp();
    const remote = await app.inject({
      method: "POST",
      url: "/api/sources",
      cookies,
      payload: {
        name: "Remote source",
        type: "remote_url",
        url: "https://example.com/sub/secret-token?key=private",
        enabled: true,
        refreshIntervalMinutes: 360,
      },
    });
    const pasted = await app.inject({
      method: "POST",
      url: "/api/sources",
      cookies,
      payload: {
        name: "Pasted source",
        type: "pasted_yaml",
        rawContent: "proxies: []",
        enabled: true,
      },
    });

    expect(remote.statusCode).toBe(201);
    expect(remote.body).not.toContain("secret-token");
    expect(remote.body).not.toContain("private");
    expect(remote.json().data.refreshIntervalMinutes).toBe(360);
    expect(remote.json().data.nextRefreshAt).toBeTruthy();
    expect(pasted.statusCode).toBe(201);
  });

  it("accepts uploaded YAML payloads above Fastify's default body limit", async () => {
    const { app, cookies } = await createAuthenticatedApp();
    const rawContent = `proxies: []\n${"#".repeat(2 * 1024 * 1024)}`;

    const uploaded = await app.inject({
      method: "POST",
      url: "/api/sources",
      cookies,
      payload: {
        name: "Large uploaded source",
        type: "uploaded_yaml",
        rawContent,
        enabled: true,
      },
    });

    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().data.name).toBe("Large uploaded source");
  });

  it("updates automatic refresh settings only for remote sources", async () => {
    const { app, cookies } = await createAuthenticatedApp();
    const remote = await app.inject({
      method: "POST",
      url: "/api/sources",
      cookies,
      payload: {
        name: "Scheduled remote",
        type: "remote_url",
        url: "https://example.com/sub",
      },
    });
    const remoteId = remote.json().data.id as string;
    const scheduled = await app.inject({
      method: "PATCH",
      url: `/api/sources/${remoteId}`,
      cookies,
      payload: { refreshIntervalMinutes: 60 },
    });
    expect(scheduled.statusCode).toBe(200);
    expect(scheduled.json().data.refreshIntervalMinutes).toBe(60);
    expect(scheduled.json().data.nextRefreshAt).toBeTruthy();

    const local = await app.inject({
      method: "POST",
      url: "/api/sources",
      cookies,
      payload: {
        name: "Local source",
        type: "pasted_yaml",
        rawContent: "proxies: []",
      },
    });
    const rejected = await app.inject({
      method: "PATCH",
      url: `/api/sources/${local.json().data.id}`,
      cookies,
      payload: { refreshIntervalMinutes: 60 },
    });
    expect(rejected.statusCode).toBe(400);
  });

  it("selects enabled remote sources whose refresh interval is due", async () => {
    const { app, cookies } = await createAuthenticatedApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/sources",
      cookies,
      payload: {
        name: "Due remote",
        type: "remote_url",
        url: "https://example.com/sub",
        refreshIntervalMinutes: 60,
      },
    });
    const source = new SourceRepository(app.database).findById(
      created.json().data.id,
    )!;
    const service = new SourceService(
      new SourceRepository(app.database),
      config,
    );

    expect(
      service.listDueForAutoRefresh(
        new Date(source.createdAt.getTime() + 59 * 60_000),
      ),
    ).toHaveLength(0);
    expect(
      service.listDueForAutoRefresh(
        new Date(source.createdAt.getTime() + 60 * 60_000),
      ),
    ).toEqual([{ id: source.id, name: "Due remote" }]);
  });

  it("disables, lists, and deletes a source", async () => {
    const { app, cookies } = await createAuthenticatedApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/sources",
      cookies,
      payload: {
        name: "Editable source",
        type: "pasted_yaml",
        rawContent: "proxies: []",
        enabled: true,
      },
    });
    const id = created.json().data.id as string;

    const disabled = await app.inject({
      method: "PATCH",
      url: `/api/sources/${id}`,
      cookies,
      payload: { enabled: false },
    });
    expect(disabled.json().data.enabled).toBe(false);

    const listed = await app.inject({
      method: "GET",
      url: "/api/sources",
      cookies,
    });
    expect(listed.json().data).toHaveLength(1);

    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/sources/${id}`,
          cookies,
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/sources/${id}`,
          cookies,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("refreshes a remote source and stores cache metadata", async () => {
    const remoteFetcher = async () => ({
      content:
        "proxies:\n  - {name: Test, type: ss, server: example.com, port: 443}",
      subscriptionUserInfo: {
        upload: 1_073_741_824,
        download: 2_147_483_648,
        total: 10_737_418_240,
        expireAt: new Date("2026-06-30T00:00:00.000Z"),
      },
    });
    const app = await createApp({ config, logger: false, remoteFetcher });
    apps.push(app);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "correct-password" },
    });
    const cookie = login.cookies.find(
      (item) => item.name === sessionCookieName,
    )!;
    const cookies = { [sessionCookieName]: cookie.value };
    const created = await app.inject({
      method: "POST",
      url: "/api/sources",
      cookies,
      payload: {
        name: "Refreshable",
        type: "remote_url",
        url: "https://example.com/sub/private-token",
        enabled: true,
      },
    });
    const id = created.json().data.id as string;

    const refreshed = await app.inject({
      method: "POST",
      url: `/api/sources/${id}/refresh`,
      cookies,
    });

    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().data.source.lastFetchStatus).toBe("success");
    expect(refreshed.json().data.source.trafficUpload).toBe(1_073_741_824);
    expect(refreshed.json().data.source.trafficDownload).toBe(2_147_483_648);
    expect(refreshed.json().data.source.trafficTotal).toBe(10_737_418_240);
    expect(refreshed.json().data.source.expireAt).toBe(
      "2026-06-30T00:00:00.000Z",
    );
    expect(refreshed.json().data.cache.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      new SourceRepository(app.database).findLatestCache(id)?.content,
    ).toContain("Test");
  });
});
