import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { loadConfig } from "../config/env";
import { sessionCookieName } from "../auth/session";
const apps: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup(remoteFetcher?: () => Promise<string>) {
  const app = await createApp({
    config: loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: ":memory:",
      ADMIN_PASSWORD: "test-password",
      SESSION_SECRET: "output-checks-session-secret-longer-than-32",
    }),
    logger: false,
    remoteFetcher,
  });
  apps.push(app);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "test-password" },
  });
  const cookies = {
    [sessionCookieName]: login.cookies.find(
      (cookie) => cookie.name === sessionCookieName,
    )!.value,
  };
  const api = (
    url: string,
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" = "GET",
    payload?: object,
  ) => app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  return { app, api };
}
const prefix = "/api/output/profiles/default-clash";
const content =
  "proxies:\n  - {name: HK Fast, type: ss, server: hk.example, port: 443, cipher: aes-128-gcm, password: secret}\n  - {name: US Fast, type: trojan, server: us.example, port: 443, password: secret}";

describe("availability and extended output configuration", () => {
  it("reports empty, ready, filtered-empty and disabled without adding access records", async () => {
    const { app, api } = await setup();
    expect((await api(`${prefix}/availability`)).json().data.state).toBe(
      "empty",
    );
    await api("/api/sources", "POST", {
      name: "Local",
      type: "pasted_yaml",
      rawContent: content,
    });
    expect((await api(`${prefix}/availability`)).json().data).toMatchObject({
      state: "ready",
      nodeCount: 2,
    });
    let profile = (
      await api(prefix, "PATCH", {
        options: { nodeFilter: { includeKeywords: ["HK"] } },
      })
    ).json().data;
    expect((await api(`${prefix}/availability`)).json().data).toMatchObject({
      state: "ready",
      nodeCount: 1,
      filteredCount: 1,
    });
    expect((await api(`${prefix}/preview`)).json().data.content).not.toContain(
      "US Fast",
    );
    expect((await api(`${prefix}/access-logs`)).json().data.total).toBe(0);
    expect(
      (await app.inject(new URL(profile.subscriptionUrl).pathname)).body,
    ).not.toContain("US Fast");
    await api(prefix, "PATCH", { options: { nodeFilter: { protocols: [] } } });
    expect((await api(`${prefix}/availability`)).json().data.state).toBe(
      "empty",
    );
    profile = (await api(prefix, "PATCH", { enabled: false })).json().data;
    expect((await api(`${prefix}/availability`)).json().data.state).toBe(
      "disabled",
    );
    expect(
      (await app.inject(new URL(profile.subscriptionUrl).pathname)).statusCode,
    ).toBe(404);
    expect((await app.inject(`${prefix}/availability`)).statusCode).toBe(401);
  });

  it("distinguishes missing content, cached refresh failures, excluded sources and deleted selections", async () => {
    let fail = false;
    const { api } = await setup(async () => {
      if (fail) throw new Error("https://private.example/secret-token");
      return content;
    });
    const source = (
      await api("/api/sources", "POST", {
        name: "Remote",
        type: "remote_url",
        url: "https://example.com/sub",
      })
    ).json().data;
    expect((await api(`${prefix}/availability`)).json().data.state).toBe(
      "error",
    );
    await api(`/api/sources/${source.id}/refresh`, "POST");
    expect((await api(`${prefix}/availability`)).json().data.state).toBe(
      "ready",
    );
    fail = true;
    await api(`/api/sources/${source.id}/refresh`, "POST");
    const cached = await api(`${prefix}/availability`);
    expect(cached.json().data).toMatchObject({
      state: "warning",
      nodeCount: 2,
      sources: [{ usingCache: true }],
    });
    expect(cached.body).not.toContain("secret-token");
    await api("/api/sources", "POST", {
      name: "Other unready",
      type: "remote_url",
      url: "https://example.com/other",
    });
    await api(prefix, "PATCH", { options: { sourceIds: [source.id] } });
    expect((await api(`${prefix}/availability`)).json().data.state).toBe(
      "warning",
    );
    await api(`/api/sources/${source.id}`, "DELETE");
    const missing = (await api(`${prefix}/availability`)).json().data;
    expect(missing.state).toBe("empty");
    expect(
      missing.checks.some((check: { key: string }) => check.key === "missing"),
    ).toBe(true);
  });

  it("persists DNS flags and single-IP normalization through global/independent rules and backup", async () => {
    const { api } = await setup();
    const created = await api("/api/rules", "POST", {
      ruleType: "IP-CIDR",
      value: "192.0.2.9",
      policy: "DIRECT",
      noResolve: true,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      value: "192.0.2.9/32",
      noResolve: true,
    });
    expect((await api(`${prefix}/preview`)).json().data.content).toContain(
      "IP-CIDR,192.0.2.9/32,DIRECT,no-resolve",
    );
    await api(`/api/rules/${created.json().data.id}`, "PATCH", {
      value: "192.0.2.10",
    });
    expect((await api("/api/rules")).json().data[0].value).toBe(
      "192.0.2.10/32",
    );
    await api(`${prefix}/rules`, "PUT", {
      rules: [
        {
          ruleType: "IP-CIDR6",
          value: "2001:db8::1",
          policy: "REJECT",
          noResolve: true,
        },
        { ruleType: "DST-PORT", value: "80/443/8000-9000", policy: "DIRECT" },
      ],
    });
    expect((await api(`${prefix}/preview`)).json().data.content).toContain(
      "IP-CIDR6,2001:db8::1/128,REJECT,no-resolve",
    );
    expect((await api(`${prefix}/rules`)).json().data[1].ruleType).toBe(
      "DST-PORT",
    );
    const backup = (await api("/api/system/backup")).json().data;
    expect((await api("/api/system/restore", "POST", backup)).statusCode).toBe(
      200,
    );
    expect((await api("/api/rules")).json().data[0].noResolve).toBe(true);
    expect((await api(`${prefix}/rules`)).json().data[0].noResolve).toBe(true);
    expect(
      (
        await api("/api/rules", "POST", {
          ruleType: "DOMAIN",
          value: "example.com",
          policy: "DIRECT",
          noResolve: true,
        })
      ).statusCode,
    ).toBe(400);
  });
});
