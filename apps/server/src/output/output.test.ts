import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { outputProfileOptionsSchema } from "@subscription-converter/shared";

import { createApp } from "../app";
import { sessionCookieName } from "../auth/session";
import { loadConfig } from "../config/env";
import { defaultClashProfileId } from "../db/defaults";
import { outputProfiles } from "../db/schema";

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

describe("Clash output preview", () => {
  it("returns parseable YAML with user rules and deduplicated proxies", async () => {
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
        rawContent: `
proxies:
  - { name: Node, type: ss, server: one.example.com, port: 443 }
  - { name: Duplicate, type: ss, server: one.example.com, port: 443 }
`,
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/rules",
      cookies,
      payload: {
        ruleType: "DOMAIN-SUFFIX",
        value: "example.com",
        policy: "PROXY",
      },
    });
    const now = new Date();
    app.database.db
      .insert(outputProfiles)
      .values({
        id: "clash-default",
        name: "Clash",
        targetClient: "clash",
        token: "test-token-that-is-at-least-24-characters",
        enabled: true,
        optionsJson: JSON.stringify(outputProfileOptionsSchema.parse({})),
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const response = await app.inject({
      method: "GET",
      url: "/api/output/preview/clash-default",
      cookies,
    });
    const body = response.json();
    const yaml = parse(body.data.yaml);

    expect(response.statusCode).toBe(200);
    expect(yaml.proxies).toHaveLength(1);
    expect(yaml.rules).toContain("DOMAIN-SUFFIX,example.com,PROXY");
    expect(yaml.rules.at(-1)).toBe("MATCH,PROXY");
    expect(yaml["proxy-groups"]).toHaveLength(2);
  });

  it("updates profile options and applies custom group filters", async () => {
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
        name: "Group source",
        type: "pasted_yaml",
        rawContent: `
proxies:
  - { name: US West, type: ss, server: us.example.com, port: 443 }
  - { name: HK Fast, type: ss, server: hk.example.com, port: 443 }
rules:
  - DOMAIN,upstream.example,DIRECT
  - MATCH,DIRECT
`,
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/rules",
      cookies,
      payload: {
        ruleType: "DOMAIN-SUFFIX",
        value: "openai.com",
        policy: "OpenAI",
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/rules",
      cookies,
      payload: {
        ruleType: "RULE-SET",
        value: "gfw_list",
        policy: "PROXY",
      },
    });

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/output/profiles/${defaultClashProfileId}`,
      cookies,
      payload: {
        options: {
          preserveUpstreamRules: false,
          subscriptionFilename: "nodes.txt",
          proxyGroups: [
            {
              name: "OpenAI",
              type: "select",
              filter: "US|United States|美",
            },
            {
              name: "Google",
              type: "url-test",
              filter: "HK|Hong Kong|港",
            },
          ],
          ruleProviders: {
            gfw_list: {
              behavior: "classical",
              url: "https://example.com/gfw.yaml",
            },
          },
          dns: null,
          matchPolicy: "PROXY",
        },
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.options.preserveUpstreamRules).toBe(false);
    expect(updated.json().data.subscriptionUrl).toMatch(/\/nodes\.txt$/);
    expect(updated.json().data.options.proxyGroups).toHaveLength(2);
    expect(updated.json().data.options.ruleProviders.gfw_list).toMatchObject({
      type: "http",
      behavior: "classical",
      interval: 86_400,
    });

    const profiles = await app.inject({
      method: "GET",
      url: "/api/output/profiles",
      cookies,
    });
    const clashProfile = profiles
      .json()
      .data.find(
        (profile: { id: string }) => profile.id === defaultClashProfileId,
      );
    expect(clashProfile.options.proxyGroups[0].name).toBe("OpenAI");
    expect(clashProfile.options.ruleProviders.gfw_list.url).toBe(
      "https://example.com/gfw.yaml",
    );

    const preview = await app.inject({
      method: "GET",
      url: `/api/output/preview/${defaultClashProfileId}`,
      cookies,
    });
    const yaml = parse(preview.json().data.yaml);
    const groups = Object.fromEntries(
      yaml["proxy-groups"].map((group: { name: string }) => [
        group.name,
        group,
      ]),
    );
    expect(yaml.rules).toEqual([
      "DOMAIN-SUFFIX,openai.com,OpenAI",
      "RULE-SET,gfw_list,PROXY",
      "MATCH,PROXY",
    ]);
    expect(yaml["rule-providers"].gfw_list).toMatchObject({
      type: "http",
      behavior: "classical",
      url: "https://example.com/gfw.yaml",
      interval: 86_400,
    });
    expect(groups.OpenAI.proxies).toEqual(["US West"]);
    expect(groups.Google.proxies).toEqual(["HK Fast"]);

    const invalid = await app.inject({
      method: "PATCH",
      url: `/api/output/profiles/${defaultClashProfileId}`,
      cookies,
      payload: {
        options: {
          ...updated.json().data.options,
          proxyGroups: [{ name: "Broken", type: "select", filter: "[" }],
        },
      },
    });
    expect(invalid.statusCode).toBe(400);

    const invalidProvider = await app.inject({
      method: "PATCH",
      url: `/api/output/profiles/${defaultClashProfileId}`,
      cookies,
      payload: {
        options: {
          ...updated.json().data.options,
          ruleProviders: {
            "gfw-list": {
              behavior: "domain",
              url: "https://example.com/gfw.yaml",
            },
          },
        },
      },
    });
    expect(invalidProvider.statusCode).toBe(400);
  });
});
