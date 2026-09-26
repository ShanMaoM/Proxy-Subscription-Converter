import { describe, expect, it } from "vitest";

import {
  clashRuleTypeSchema,
  createSubscriptionSourceSchema,
  outputProfileOptionsSchema,
  outputProfileSchema,
  userRuleSchema,
} from "./schemas";

const baseRule = {
  id: "rule-1",
  policy: "PROXY",
  enabled: true,
  sortOrder: 0,
  note: null,
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

describe("shared schemas", () => {
  it.each([
    ["IP-CIDR", "1.2.3.4/24/extra"],
    ["IP-CIDR", "1.2.3.4/"],
    ["IP-CIDR6", "not:ipv6/64"],
    ["IP-CIDR6", "::::/64"],
  ])("rejects malformed %s value %s", (ruleType, value) => {
    expect(
      userRuleSchema.safeParse({ ...baseRule, ruleType, value }).success,
    ).toBe(false);
  });

  it("accepts valid IPv4 and IPv6 CIDRs", () => {
    expect(
      userRuleSchema.safeParse({
        ...baseRule,
        ruleType: "IP-CIDR",
        value: "10.0.0.0/8",
      }).success,
    ).toBe(true);
    expect(
      userRuleSchema.safeParse({
        ...baseRule,
        ruleType: "IP-CIDR6",
        value: "2001:db8::/32",
      }).success,
    ).toBe(true);
  });
  it("rejects unknown Clash rule types", () => {
    expect(clashRuleTypeSchema.safeParse("UNKNOWN").success).toBe(false);
  });

  it("requires MATCH rules to omit value", () => {
    const result = userRuleSchema.safeParse({
      ...baseRule,
      ruleType: "MATCH",
      value: "example.com",
    });

    expect(result.success).toBe(false);
  });

  it("rejects negative sort order", () => {
    const result = userRuleSchema.safeParse({
      ...baseRule,
      ruleType: "DOMAIN-SUFFIX",
      value: "example.com",
      sortOrder: -1,
    });

    expect(result.success).toBe(false);
  });

  it("validates source-specific input fields", () => {
    expect(
      createSubscriptionSourceSchema.safeParse({
        name: "Remote",
        type: "remote_url",
        rawContent: "proxies: []",
      }).success,
    ).toBe(false);
    expect(
      createSubscriptionSourceSchema.safeParse({
        name: "Local",
        type: "pasted_yaml",
        rawContent: "proxies: []",
        refreshIntervalMinutes: 60,
      }).success,
    ).toBe(false);
    expect(
      createSubscriptionSourceSchema.parse({
        name: "Remote",
        type: "remote_url",
        url: "https://example.com/sub",
        refreshIntervalMinutes: 360,
      }).refreshIntervalMinutes,
    ).toBe(360);
  });

  it("supports proxy groups, rule providers and dns options", () => {
    const parsed = outputProfileOptionsSchema.parse({
      preserveUpstreamRules: false,
      proxyGroups: [
        {
          name: "OpenAI",
          type: "select",
          filter: "US|United States|美",
        },
      ],
      ruleProviders: {
        ads: {
          type: "http",
          behavior: "domain",
          url: "https://example.com/ads.yaml",
        },
      },
      dns: {
        enable: true,
        nameserver: ["1.1.1.1"],
      },
      matchPolicy: "PROXY",
      subscriptionFilename: "nodes.txt",
    });

    expect(parsed.dns?.enable).toBe(true);
    expect(parsed.proxyGroups).toHaveLength(1);
    expect(parsed.preserveUpstreamRules).toBe(false);
    expect(parsed.subscriptionFilename).toBe("nodes.txt");
    expect(parsed.proxyGroups[0].proxies).toEqual([]);
    expect(parsed.ruleProviders.ads.type).toBe("http");
    expect(parsed.ruleProviders.ads.interval).toBe(86_400);
  });

  it("rejects invalid proxy group filters and duplicate names", () => {
    expect(
      outputProfileOptionsSchema.safeParse({
        proxyGroups: [{ name: "OpenAI", type: "select", filter: "[" }],
      }).success,
    ).toBe(false);
    expect(
      outputProfileOptionsSchema.safeParse({
        proxyGroups: [
          { name: "OpenAI", type: "select" },
          { name: "openai", type: "url-test" },
        ],
      }).success,
    ).toBe(false);
  });

  it("validates rule provider names and HTTP URLs", () => {
    expect(
      outputProfileOptionsSchema.safeParse({
        ruleProviders: {
          "gfw-list": {
            behavior: "domain",
            url: "https://example.com/gfw.yaml",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      outputProfileOptionsSchema.safeParse({
        ruleProviders: {
          gfw_list: {
            behavior: "classical",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects unsafe subscription filenames", () => {
    expect(
      outputProfileOptionsSchema.safeParse({
        subscriptionFilename: "nodes.json",
      }).success,
    ).toBe(false);
    expect(
      outputProfileSchema.safeParse({
        id: "clash",
        name: "Clash",
        targetClient: "clash",
        token: "a".repeat(32),
        enabled: true,
        options: { subscriptionFilename: "nodes.conf" },
        createdAt: baseRule.createdAt,
        updatedAt: baseRule.updatedAt,
      }).success,
    ).toBe(false);
    expect(
      outputProfileOptionsSchema.safeParse({
        subscriptionFilename: "../clash.yaml",
      }).success,
    ).toBe(false);
    expect(
      outputProfileOptionsSchema.safeParse({
        subscriptionFilename: "custom-clash.yaml",
      }).success,
    ).toBe(true);
  });
});
