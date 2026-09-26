import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../app";
import { sessionCookieName } from "../auth/session";
import { loadConfig } from "../config/env";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
const config = loadConfig({
  NODE_ENV: "test",
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "correct-password",
  SESSION_SECRET: "test-session-secret-that-is-longer-than-32-chars",
  DATABASE_URL: ":memory:",
  PUBLIC_BASE_URL: "https://subscriptions.example.com",
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Shadowrocket experimental output", () => {
  it("serves supported nodes and reports skipped nodes", async () => {
    const app = await createApp({ config, logger: false });
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
    await app.inject({
      method: "POST",
      url: "/api/sources",
      cookies,
      payload: {
        name: "Mixed",
        type: "pasted_yaml",
        rawContent: `
proxies:
  - { name: SS, type: ss, server: ss.example.com, port: 443, cipher: aes-128-gcm, password: secret }
  - { name: WG, type: wireguard, server: wg.example.com, port: 443 }
`,
      },
    });
    const profiles = await app.inject({
      method: "GET",
      url: "/api/output/profiles",
      cookies,
    });
    const shadow = profiles
      .json()
      .data.find(
        (profile: { targetClient: string }) =>
          profile.targetClient === "shadowrocket",
      );
    const preview = await app.inject({
      method: "GET",
      url: `/api/output/shadowrocket/${shadow.id}/preview`,
      cookies,
    });
    expect(preview.json().data.summary.supportedCount).toBe(1);
    expect(preview.json().data.summary.skippedCount).toBe(1);

    const publicResponse = await app.inject({
      method: "GET",
      url: new URL(shadow.subscriptionUrl).pathname,
    });
    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.body).toMatch(/^ss:\/\//);
    expect(publicResponse.headers["content-type"]).toContain("text/plain");
  });
});
