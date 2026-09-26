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
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function authenticatedApp() {
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

describe("rule CRUD", () => {
  it("creates a DOMAIN-SUFFIX rule and rejects invalid CIDR", async () => {
    const { app, cookies } = await authenticatedApp();
    const valid = await app.inject({
      method: "POST",
      url: "/api/rules",
      cookies,
      payload: {
        ruleType: "DOMAIN-SUFFIX",
        value: "example.com",
        policy: "PROXY",
      },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/api/rules",
      cookies,
      payload: {
        ruleType: "IP-CIDR",
        value: "999.1.1.1/99",
        policy: "DIRECT",
      },
    });

    expect(valid.statusCode).toBe(201);
    expect(invalid.statusCode).toBe(400);
  });

  it("rejects multiple enabled MATCH rules and MATCH before another rule", async () => {
    const { app, cookies } = await authenticatedApp();
    const match = await app.inject({
      method: "POST",
      url: "/api/rules",
      cookies,
      payload: {
        ruleType: "MATCH",
        value: null,
        policy: "PROXY",
      },
    });
    expect(match.statusCode).toBe(201);

    const secondMatch = await app.inject({
      method: "POST",
      url: "/api/rules",
      cookies,
      payload: {
        ruleType: "MATCH",
        value: null,
        policy: "DIRECT",
      },
    });
    expect(secondMatch.statusCode).toBe(400);

    const afterMatch = await app.inject({
      method: "POST",
      url: "/api/rules",
      cookies,
      payload: {
        ruleType: "DOMAIN",
        value: "example.com",
        policy: "DIRECT",
      },
    });
    expect(afterMatch.statusCode).toBe(400);
  });

  it("reorders rules and persists disabled state", async () => {
    const { app, cookies } = await authenticatedApp();
    const first = await app.inject({
      method: "POST",
      url: "/api/rules",
      cookies,
      payload: {
        ruleType: "DOMAIN",
        value: "one.example.com",
        policy: "PROXY",
      },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/rules",
      cookies,
      payload: {
        ruleType: "DOMAIN",
        value: "two.example.com",
        policy: "DIRECT",
      },
    });
    const firstId = first.json().data.id as string;
    const secondId = second.json().data.id as string;

    const reordered = await app.inject({
      method: "POST",
      url: "/api/rules/reorder",
      cookies,
      payload: { ids: [secondId, firstId] },
    });
    expect(
      reordered.json().data.map((rule: { id: string }) => rule.id),
    ).toEqual([secondId, firstId]);

    const disabled = await app.inject({
      method: "PATCH",
      url: `/api/rules/${firstId}`,
      cookies,
      payload: { enabled: false },
    });
    expect(disabled.json().data.enabled).toBe(false);
  });

  it("saves the full rule draft and validates MATCH position on save", async () => {
    const { app, cookies } = await authenticatedApp();

    const invalidDraft = await app.inject({
      method: "PUT",
      url: "/api/rules",
      cookies,
      payload: {
        rules: [
          {
            ruleType: "MATCH",
            value: null,
            policy: "PROXY",
            enabled: true,
          },
          {
            ruleType: "DOMAIN",
            value: "after-match.example.com",
            policy: "DIRECT",
            enabled: true,
          },
        ],
      },
    });
    expect(invalidDraft.statusCode).toBe(400);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/rules",
      cookies,
      payload: {
        rules: [
          {
            ruleType: "DOMAIN",
            value: "example.com",
            policy: "DIRECT",
            enabled: true,
          },
          {
            ruleType: "MATCH",
            value: null,
            policy: "PROXY",
            enabled: true,
          },
        ],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(
      saved
        .json()
        .data.map((rule: { ruleType: string; sortOrder: number }) => [
          rule.ruleType,
          rule.sortOrder,
        ]),
    ).toEqual([
      ["DOMAIN", 0],
      ["MATCH", 1],
    ]);
  });
});
