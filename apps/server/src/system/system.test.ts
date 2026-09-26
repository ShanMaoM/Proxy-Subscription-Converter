import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../app";
import { sessionCookieName } from "../auth/session";
import { loadConfig, type AppConfig } from "../config/env";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];

function testConfig(secret: string) {
  return loadConfig({
    NODE_ENV: "test",
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "correct-password",
    SESSION_SECRET: secret,
    DATABASE_URL: ":memory:",
  });
}

async function createAuthenticatedApp(
  config: AppConfig,
  remoteFetcher?: (url: string) => Promise<string>,
) {
  const app = await createApp({ config, logger: false, remoteFetcher });
  apps.push(app);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "correct-password" },
  });
  const cookie = login.cookies.find((item) => item.name === sessionCookieName)!;
  return { app, cookies: { [sessionCookieName]: cookie.value } };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("system maintenance", () => {
  it("rejects invalid MATCH ordering in backups before deleting any data", async () => {
    const { app, cookies } = await createAuthenticatedApp(
      testConfig("backup-rule-validation-secret-longer-than-32"),
    );
    await app.inject({
      method: "POST",
      url: "/api/rules",
      cookies,
      payload: { ruleType: "MATCH", policy: "DIRECT" },
    });
    const backup = (
      await app.inject({ url: "/api/system/backup", cookies })
    ).json().data;
    backup.rules.push({
      ...backup.rules[0],
      id: "extra-rule",
      sortOrder: 1,
      ruleType: "DOMAIN",
      value: "example.com",
    });
    const result = await app.inject({
      method: "POST",
      url: "/api/system/restore",
      cookies,
      payload: backup,
    });
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain("MATCH rule must be last");
    expect(
      (await app.inject({ url: "/api/rules", cookies })).json().data,
    ).toHaveLength(1);
  });
  it("exports and restores configuration with a different encryption secret", async () => {
    const first = await createAuthenticatedApp(
      testConfig("first-test-session-secret-longer-than-32-chars"),
    );
    const sensitiveUrl =
      "https://user:password@example.com/private/token-value?key=query-secret";
    await first.app.inject({
      method: "POST",
      url: "/api/sources",
      cookies: first.cookies,
      payload: {
        name: "Portable remote",
        type: "remote_url",
        url: sensitiveUrl,
        refreshIntervalMinutes: 360,
      },
    });
    await first.app.inject({
      method: "POST",
      url: "/api/rules",
      cookies: first.cookies,
      payload: {
        ruleType: "DOMAIN-SUFFIX",
        value: "example.com",
        policy: "PROXY",
      },
    });

    const exported = await first.app.inject({
      method: "GET",
      url: "/api/system/backup",
      cookies: first.cookies,
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().data.sources[0].url).toBe(sensitiveUrl);
    expect(exported.json().data.sources[0].refreshIntervalMinutes).toBe(360);

    const second = await createAuthenticatedApp(
      testConfig("second-test-session-secret-longer-than-32-chars"),
    );
    const restored = await second.app.inject({
      method: "POST",
      url: "/api/system/restore",
      cookies: second.cookies,
      payload: exported.json().data,
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data).toMatchObject({
      sources: 1,
      rules: 1,
      outputProfiles: 2,
    });

    const listedSources = await second.app.inject({
      method: "GET",
      url: "/api/sources",
      cookies: second.cookies,
    });
    expect(listedSources.body).not.toContain("token-value");
    expect(listedSources.body).not.toContain("query-secret");
    expect(listedSources.json().data[0].urlMasked).toContain("***");
    expect(listedSources.json().data[0].refreshIntervalMinutes).toBe(360);

    const reExported = await second.app.inject({
      method: "GET",
      url: "/api/system/backup",
      cookies: second.cookies,
    });
    expect(reExported.json().data.sources[0].url).toBe(sensitiveUrl);
  });

  it("validates the entire backup before replacing existing configuration", async () => {
    const { app, cookies } = await createAuthenticatedApp(
      testConfig("validation-test-session-secret-longer-than-32"),
    );
    await app.inject({
      method: "POST",
      url: "/api/sources",
      cookies,
      payload: {
        name: "Keep me",
        type: "pasted_yaml",
        rawContent: "proxies: []",
      },
    });

    const invalidRestore = await app.inject({
      method: "POST",
      url: "/api/system/restore",
      cookies,
      payload: {
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: [],
        sources: [{ id: "broken" }],
        rules: [],
        outputProfiles: [],
      },
    });
    expect(invalidRestore.statusCode).toBe(400);

    const sources = await app.inject({
      method: "GET",
      url: "/api/sources",
      cookies,
    });
    expect(sources.json().data).toHaveLength(1);
    expect(sources.json().data[0].name).toBe("Keep me");
  });

  it("redacts sensitive remote errors from source state and operation logs", async () => {
    const sensitiveUrl =
      "https://example.com/private/full-token?access_token=query-secret";
    const { app, cookies } = await createAuthenticatedApp(
      testConfig("logging-test-session-secret-longer-than-32-chars"),
      async (url) => {
        throw new Error(`Fetch failed for ${url}`);
      },
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/sources",
      cookies,
      payload: {
        name: "Failing remote",
        type: "remote_url",
        url: sensitiveUrl,
      },
    });

    await app.inject({
      method: "POST",
      url: `/api/sources/${created.json().data.id}/refresh`,
      cookies,
    });
    const source = await app.inject({
      method: "GET",
      url: `/api/sources/${created.json().data.id}`,
      cookies,
    });
    const logs = await app.inject({
      method: "GET",
      url: "/api/system/logs",
      cookies,
    });

    expect(source.body).not.toContain("full-token");
    expect(source.body).not.toContain("query-secret");
    expect(logs.statusCode).toBe(200);
    expect(logs.body).not.toContain("full-token");
    expect(logs.body).not.toContain("query-secret");
    expect(
      logs
        .json()
        .data.some(
          (entry: { action: string; level: string }) =>
            entry.action === "source.refresh" && entry.level === "error",
        ),
    ).toBe(true);
  });

  it("requires authentication for maintenance endpoints", async () => {
    const app = await createApp({
      config: testConfig("auth-test-session-secret-longer-than-32-characters"),
      logger: false,
    });
    apps.push(app);
    expect(
      (await app.inject({ method: "GET", url: "/api/system/logs" })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/api/system/backup" }))
        .statusCode,
    ).toBe(401);
  });
});
