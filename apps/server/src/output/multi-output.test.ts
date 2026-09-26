import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createApp } from "../app";
import { loadConfig } from "../config/env";
import { sessionCookieName } from "../auth/session";
import { ensureDefaultOutputProfiles } from "../db/defaults";
import { AccessLogService } from "./access-log-service";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup(trustProxy = "0") {
  const app = await createApp({
    logger: false,
    config: loadConfig({
      NODE_ENV: "test",
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "correct-password",
      SESSION_SECRET: "multi-output-test-secret-longer-than-32-chars",
      DATABASE_URL: ":memory:",
      TRUST_PROXY_HOPS: trustProxy,
    }),
  });
  apps.push(app);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "correct-password" },
  });
  const cookies = {
    [sessionCookieName]: login.cookies.find(
      (cookie) => cookie.name === sessionCookieName,
    )!.value,
  };
  const api = (
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    url: string,
    payload?: object,
  ) => app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  const create = async (
    name: string,
    options: object = {},
    targetClient = "clash",
  ) => {
    const response = await api("POST", "/api/output/profiles", {
      name,
      targetClient,
      options,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data;
  };
  const source = async (name: string) =>
    (
      await api("POST", "/api/sources", {
        name,
        type: "pasted_yaml",
        rawContent: `proxies:\n  - { name: ${name}, type: ss, server: ${name}.example.com, port: 443, cipher: aes-128-gcm, password: secret }`,
      })
    ).json().data;
  return { app, api, create, source };
}
const path = (profile: { subscriptionUrl: string }) =>
  new URL(profile.subscriptionUrl).pathname;
const endpoint = (id: string, suffix = "") =>
  `/api/output/profiles/${id}${suffix}`;

describe("independent output profiles", () => {
  it("isolates sources and rules across YAML, Base64 and Shadowrocket outputs", async () => {
    const { app, api, create, source } = await setup();
    const a = await source("Alpha");
    const b = await source("Beta");
    await api("POST", "/api/sources", {
      name: "Unready",
      type: "remote_url",
      url: "https://example.com/sub",
    });
    await api("POST", "/api/rules", {
      ruleType: "DOMAIN",
      value: "global.example",
      policy: "DIRECT",
    });
    const first = await create("Personal", {
      sourceIds: [a.id],
      preserveUpstreamRules: false,
      matchPolicy: "DIRECT",
    });
    const second = await create("Work", {
      sourceIds: [b.id],
      customRules: [],
      matchPolicy: "REJECT",
    });
    expect(first.subscriptionUrl).not.toBe(second.subscriptionUrl);
    expect(first.token).toBeUndefined();
    let response = await app.inject(path(first));
    expect(response.statusCode).toBe(200);
    expect(
      parse(response.body).proxies.map((p: { name: string }) => p.name),
    ).toEqual(["Alpha"]);
    expect(parse(response.body).rules).toEqual([
      "DOMAIN,global.example,DIRECT",
      "MATCH,DIRECT",
    ]);
    response = await app.inject(path(second));
    expect(
      parse(response.body).proxies.map((p: { name: string }) => p.name),
    ).toEqual(["Beta"]);
    expect(parse(response.body).rules).toEqual(["MATCH,REJECT"]);
    const text = await create("Nodes", {
      sourceIds: [a.id],
      subscriptionFilename: "personal.txt",
    });
    const conf = await create(
      "Phone",
      { sourceIds: [b.id], subscriptionFilename: "phone.conf" },
      "shadowrocket",
    );
    expect(
      Buffer.from((await app.inject(path(text))).body, "base64").toString(),
    ).toContain("Alpha");
    expect((await app.inject(path(conf))).body).toContain("Beta");
    for (const profile of [first, text, conf]) {
      const preview = (
        await api("GET", endpoint(profile.id, "/preview"))
      ).json().data;
      expect(preview.content).toBe((await app.inject(path(profile))).body);
    }
    expect(
      (await api("GET", "/api/output/profiles/default-clash/preview"))
        .statusCode,
    ).toBe(409);
    await api("PATCH", endpoint(first.id), {
      options: { ...first.options, sourceIds: [] },
    });
    expect(parse((await app.inject(path(first))).body).proxies).toEqual([]);
    expect(parse((await app.inject(path(second))).body).proxies).toHaveLength(
      1,
    );
    await api("PATCH", `/api/sources/${b.id}`, { enabled: false });
    expect(parse((await app.inject(path(second))).body).proxies).toEqual([]);
  });

  it("keeps independent rules separate, validates MATCH and rejects unavailable policy references", async () => {
    const { app, api, create } = await setup();
    await api("POST", "/api/rules", {
      ruleType: "DOMAIN",
      value: "global.example",
      policy: "OnlyOne",
    });
    const one = await create("One", {
      proxyGroups: [{ name: "OnlyOne", type: "select" }],
    });
    const two = await create("Two");
    expect((await app.inject(path(one))).statusCode).toBe(200);
    expect((await app.inject(path(two))).statusCode).toBe(409);
    expect(
      (await api("GET", endpoint(two.id, "/rules"))).json().data[0].value,
    ).toBe("global.example");
    const rules = [
      { ruleType: "DOMAIN", value: "private.example", policy: "DIRECT" },
      { ruleType: "MATCH", policy: "REJECT" },
    ];
    const saved = await api("PUT", endpoint(two.id, "/rules"), { rules });
    expect(saved.statusCode).toBe(200);
    const savedRules = saved.json().data;
    expect(parse((await app.inject(path(two))).body).rules).toEqual([
      "DOMAIN,private.example,DIRECT",
      "MATCH,REJECT",
    ]);
    expect((await api("GET", "/api/rules")).json().data[0].value).toBe(
      "global.example",
    );
    expect(
      (
        await api("PUT", endpoint(two.id, "/rules"), {
          rules: [...rules].reverse(),
        })
      ).statusCode,
    ).toBe(400);
    expect((await api("GET", endpoint(two.id, "/rules"))).json().data).toEqual(
      savedRules,
    );
    const invalid = await api("PATCH", endpoint(two.id), {
      options: { customRules: [...savedRules, savedRules[0]] },
    });
    expect(invalid.statusCode).toBe(400);
    await api("PUT", endpoint(two.id, "/rules"), {
      rules: [{ ruleType: "RULE-SET", value: "missing_set", policy: "DIRECT" }],
    });
    expect((await app.inject(path(two))).statusCode).toBe(409);
  });

  it("validates selections and client filenames without partial writes", async () => {
    const { api, create, source } = await setup();
    const a = await source("Alpha");
    const profile = await create("Keep");
    for (const options of [
      { sourceIds: ["missing"] },
      { sourceIds: [a.id, a.id] },
      { subscriptionFilename: "bad.conf" },
    ]) {
      expect(
        (
          await api("PATCH", endpoint(profile.id), {
            name: "Do not save",
            options,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (await api("GET", "/api/output/profiles"))
        .json()
        .data.find((p: { id: string }) => p.id === profile.id).name,
    ).toBe("Keep");
    expect(
      (
        await api("POST", "/api/output/profiles", {
          name: "Phone",
          targetClient: "shadowrocket",
          options: { subscriptionFilename: "wrong.yaml" },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("preserves URLs on rename, invalidates disabled/reset/deleted links and never reseeds a deleted default", async () => {
    const { app, api, create } = await setup();
    const profile = await create("Old");
    const renamed = (
      await api("PATCH", endpoint(profile.id), { name: "New", enabled: false })
    ).json().data;
    expect(renamed.subscriptionUrl).toBe(profile.subscriptionUrl);
    expect((await app.inject(path(profile))).statusCode).toBe(404);
    expect(
      (await api("GET", endpoint(profile.id, "/preview"))).statusCode,
    ).toBe(200);
    await api("PATCH", endpoint(profile.id), { enabled: true });
    expect((await app.inject(path(profile))).statusCode).toBe(200);
    const reset = (
      await api("POST", `/api/output/${profile.id}/reset-token`)
    ).json().data;
    expect((await app.inject(path(profile))).statusCode).toBe(404);
    expect((await app.inject(path(reset))).statusCode).toBe(200);
    await api("DELETE", endpoint("default-clash"));
    await api("DELETE", endpoint("default-shadowrocket"));
    ensureDefaultOutputProfiles(app.database);
    expect((await api("GET", "/api/output/profiles")).json().data).toHaveLength(
      1,
    );
    expect((await api("DELETE", endpoint(profile.id))).statusCode).toBe(400);
    await create("Replacement");
    expect((await api("DELETE", endpoint(profile.id))).statusCode).toBe(204);
    expect((await app.inject(path(reset))).statusCode).toBe(404);
    expect(
      app.database.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM subscription_access_logs WHERE profile_id = ?",
        )
        .get(profile.id),
    ).toEqual({ n: 0 });
  });
});

describe("per-output access records", () => {
  it("records successful HEAD/GET and failures with IP, ignores spoofed headers and protects private endpoints", async () => {
    const { app, api, create } = await setup();
    const one = await create("One"),
      two = await create("Two");
    await api("GET", endpoint(one.id, "/preview"));
    expect(
      (await api("GET", endpoint(one.id, "/access-logs"))).json().data.total,
    ).toBe(0);
    await app.inject({
      url: path(one),
      remoteAddress: "::ffff:192.0.2.9",
      headers: { "x-forwarded-for": "203.0.113.77" },
    });
    await app.inject({
      method: "HEAD",
      url: path(one),
      remoteAddress: "2001:db8::1",
    });
    await app.inject(path(one).replace(/yaml$/, "exe"));
    await api("PATCH", endpoint(one.id), { enabled: false });
    await app.inject(path(one));
    await api("POST", "/api/sources", {
      name: "Unready",
      type: "remote_url",
      url: "https://example.com/sub",
    });
    await app.inject(path(two));
    await app.inject("/sub/unknown-token/clash.yaml");
    const logs = (await api("GET", endpoint(one.id, "/access-logs"))).json()
      .data;
    expect(logs.total).toBe(4);
    expect(
      logs.items.map((item: { statusCode: number }) => item.statusCode),
    ).toEqual([404, 404, 200, 200]);
    expect(logs.items[2]).toMatchObject({
      ip: "2001:db8::1",
      method: "HEAD",
      format: "yaml",
    });
    expect(logs.items[3].ip).toBe("192.0.2.9");
    expect(JSON.stringify(logs)).not.toContain(
      one.subscriptionUrl.split("/").at(-2),
    );
    expect(
      (await api("GET", endpoint(two.id, "/access-logs"))).json().data.items[0]
        .statusCode,
    ).toBe(409);
    for (const suffix of ["/access-logs", "/preview", "/rules"])
      expect((await app.inject(endpoint(one.id, suffix))).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/output/profiles",
          payload: { name: "No", targetClient: "clash" },
        })
      ).statusCode,
    ).toBe(401);
    const first = (
      await api("GET", endpoint(one.id, "/access-logs?limit=2"))
    ).json().data;
    const second = (
      await api(
        "GET",
        endpoint(one.id, `/access-logs?limit=2&before=${first.nextCursor}`),
      )
    ).json().data;
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(4);
    expect(second.nextCursor).toBeNull();
    expect(
      (await api("GET", endpoint(one.id, "/access-logs?limit=1000")))
        .statusCode,
    ).toBe(400);
  });

  it("accepts only the nearest configured forwarded hop", async () => {
    const { app, api, create } = await setup("1");
    const profile = await create("Proxy");
    await app.inject({
      url: path(profile),
      remoteAddress: "172.20.0.2",
      headers: { "x-forwarded-for": "203.0.113.99, 192.0.2.10" },
    });
    expect(
      (await api("GET", endpoint(profile.id, "/access-logs"))).json().data
        .items[0].ip,
    ).toBe("192.0.2.10");
  });

  it("bounds retention and exports configuration without access history", async () => {
    const { app, api, create } = await setup();
    const profile = await create("Retention", {
      sourceIds: [],
      customRules: [],
    });
    const db = app.database.sqlite;
    const insert = db.prepare(
      "INSERT INTO subscription_access_logs(profile_id,ip,method,format,status_code,created_at) VALUES (?, '192.0.2.1', 'GET', 'yaml', 200, ?)",
    );
    db.transaction(() => {
      for (let i = 0; i < 10_005; i++) insert.run(profile.id, Date.now());
      insert.run(profile.id, Date.now() - 31 * 86_400_000);
    })();
    const service = new AccessLogService(app.database);
    service.record(profile.id, "192.0.2.2", "GET", "yaml", 200);
    const logs = service.list(profile.id, undefined, 5);
    expect(logs.total).toBe(10_000);
    expect(logs.items[0].ip).toBe("192.0.2.2");
    const backup = (await api("GET", "/api/system/backup")).json().data;
    expect(JSON.stringify(backup)).not.toContain("192.0.2.1");
    expect(
      backup.outputProfiles.find((p: { id: string }) => p.id === profile.id)
        .options,
    ).toMatchObject({ sourceIds: [], customRules: [] });
    expect((await api("POST", "/api/system/restore", backup)).statusCode).toBe(
      200,
    );
    expect(service.list(profile.id, undefined, 5).total).toBe(0);
    expect((await app.inject(path(profile))).statusCode).toBe(200);
    const invalid = structuredClone(backup);
    const now = new Date().toISOString();
    invalid.outputProfiles[0].options.customRules = [
      {
        id: "match",
        ruleType: "MATCH",
        value: null,
        policy: "DIRECT",
        enabled: true,
        sortOrder: 0,
        note: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "domain",
        ruleType: "DOMAIN",
        value: "example.com",
        policy: "DIRECT",
        enabled: true,
        sortOrder: 1,
        note: null,
        createdAt: now,
        updatedAt: now,
      },
    ];
    expect((await api("POST", "/api/system/restore", invalid)).statusCode).toBe(
      400,
    );
    expect(service.list(profile.id, undefined, 5).total).toBe(1);
  });
});
