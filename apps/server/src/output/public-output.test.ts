import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseNodeSubscription } from "@subscription-converter/converter";

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

describe("public Clash subscription", () => {
  it("serves the token URL and invalidates it after reset", async () => {
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
        name: "Inline",
        type: "pasted_yaml",
        rawContent:
          "hosts:\n  example.com: 192.0.2.10\nproxies:\n  - {name: Node, type: ss, server: example.com, port: 443, cipher: aes-128-gcm, password: fixture-secret, plugin: obfs, plugin-opts: {mode: http, host: obfs.invalid}}",
      },
    });
    const profiles = await app.inject({
      method: "GET",
      url: "/api/output/profiles",
      cookies,
    });
    const oldUrl = new URL(profiles.json().data[0].subscriptionUrl);

    const publicResponse = await app.inject({
      method: "GET",
      url: oldUrl.pathname,
    });
    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.headers["content-type"]).toContain("text/yaml");
    expect(publicResponse.headers["content-disposition"]).toBe(
      'inline; filename="clash.yaml"',
    );
    expect(parse(publicResponse.body).hosts).toEqual({
      "example.com": "192.0.2.10",
    });
    const publicBase64 = await app.inject({
      url: `/sub/${oldUrl.pathname.split("/")[2]}/nodes.txt`,
    });
    expect(publicBase64.statusCode).toBe(200);
    expect(parseNodeSubscription(publicBase64.body).proxies[0]).toMatchObject({
      server: "192.0.2.10",
      password: "fixture-secret",
      plugin: "obfs",
      "plugin-opts": { mode: "http", host: "obfs.invalid" },
    });

    const customYaml = await app.inject({
      method: "GET",
      url: `/sub/${oldUrl.pathname.split("/")[2]}/my-config.yml`,
    });
    expect(customYaml.statusCode).toBe(200);
    expect(customYaml.headers["content-type"]).toContain("text/yaml");
    expect(customYaml.headers["content-disposition"]).toBe(
      'inline; filename="my-config.yml"',
    );

    const unicode = await app.inject({
      url: `/sub/${oldUrl.pathname.split("/")[2]}/${encodeURIComponent("我的订阅.yaml")}`,
    });
    expect(unicode.statusCode).toBe(200);
    expect(unicode.headers["content-disposition"]).toContain(
      `filename*=UTF-8''${encodeURIComponent("我的订阅.yaml")}`,
    );

    const reset = await app.inject({
      method: "POST",
      url: "/api/output/default-clash/reset-token",
      cookies,
    });
    const newUrl = new URL(reset.json().data.subscriptionUrl);
    expect(newUrl.pathname).not.toBe(oldUrl.pathname);
    expect(
      (await app.inject({ method: "GET", url: oldUrl.pathname })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: newUrl.pathname })).statusCode,
    ).toBe(200);
  });

  it("returns 404 for an unknown token", async () => {
    const app = await createApp({ config, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/sub/not-a-real-token/clash.yaml",
    });
    expect(response.statusCode).toBe(404);
  });

  it("serves Base64 node subscriptions for custom .txt filenames", async () => {
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
        name: "Inline",
        type: "pasted_yaml",
        rawContent:
          "proxies:\n  - {name: Node, type: ss, server: example.com, port: 443, cipher: aes-128-gcm, password: secret}",
      },
    });
    const profiles = await app.inject({
      method: "GET",
      url: "/api/output/profiles",
      cookies,
    });
    const clash = profiles
      .json()
      .data.find(
        (profile: { targetClient: string }) => profile.targetClient === "clash",
      );
    const token = new URL(clash.subscriptionUrl).pathname.split("/")[2];

    const response = await app.inject({
      method: "GET",
      url: `/sub/${token}/phone-subscription.txt`,
    });

    expect(response.statusCode).toBe(200);
    expect(Buffer.from(response.body, "base64").toString("utf8")).toMatch(
      /^ss:\/\//,
    );
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["content-disposition"]).toBe(
      'inline; filename="phone-subscription.txt"',
    );
  });

  it("serves Shadowrocket content for custom .conf filenames", async () => {
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
        name: "Inline",
        type: "pasted_yaml",
        rawContent:
          "proxies:\n  - {name: Node, type: ss, server: example.com, port: 443, cipher: aes-128-gcm, password: secret}",
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
    const token = new URL(shadow.subscriptionUrl).pathname.split("/")[2];

    const response = await app.inject({
      method: "GET",
      url: `/sub/${token}/phone-subscription.conf`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatch(/^ss:\/\//);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["content-disposition"]).toBe(
      'inline; filename="phone-subscription.conf"',
    );
  });
});
