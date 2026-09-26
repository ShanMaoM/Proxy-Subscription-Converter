import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { generateClashYaml } from "./generate-clash-yaml";
import { outputProfileOptionsSchema } from "@subscription-converter/shared";

describe("generateClashYaml", () => {
  it("remaps rules referencing discarded upstream groups and keeps no-resolve", () => {
    const result = generateClashYaml({
      sources: [
        {
          sourceName: "Airport",
          content:
            "proxies: []\nproxy-groups:\n  - {name: Airport Group, type: select, proxies: [DIRECT]}\nrules:\n  - DOMAIN,example.com,Airport Group\n  - IP-CIDR,10.0.0.0/8,Airport Group,no-resolve",
        },
      ],
      rules: [],
      options: outputProfileOptionsSchema.parse({}),
    });
    expect(result.config.rules).toEqual([
      "DOMAIN,example.com,PROXY",
      "IP-CIDR,10.0.0.0/8,PROXY,no-resolve",
      "MATCH,PROXY",
    ]);
    expect(result.config["proxy-groups"]).toContainEqual(
      expect.objectContaining({ name: "AUTO", proxies: ["DIRECT"] }),
    );
    expect(result.warnings).toHaveLength(2);
  });
  it("generates parseable YAML without imported subscription groups", () => {
    const result = generateClashYaml({
      sources: [
        {
          sourceName: "A",
          content: `
proxies:
  - { name: Node, type: ss, server: one.example.com, port: 443 }
proxy-groups:
  - { name: Upstream, type: select, proxies: [Node] }
rule-providers:
  upstream:
    type: http
    behavior: domain
    url: https://example.com/upstream.yaml
dns:
  enable: true
rules:
  - DOMAIN,upstream.example,PROXY
  - MATCH,DIRECT
`,
        },
        {
          sourceName: "B",
          content: `
proxies:
  - { name: Node, type: ss, server: one.example.com, port: 443 }
`,
        },
      ],
      rules: [
        {
          id: "rule-1",
          ruleType: "DOMAIN-SUFFIX",
          value: "example.com",
          policy: "PROXY",
          enabled: true,
          sortOrder: 0,
          note: null,
          createdAt: "2026-06-14T00:00:00.000Z",
          updatedAt: "2026-06-14T00:00:00.000Z",
        },
        {
          id: "rule-2",
          ruleType: "RULE-SET",
          value: "custom",
          policy: "PROXY",
          enabled: true,
          sortOrder: 1,
          note: null,
          createdAt: "2026-06-14T00:00:00.000Z",
          updatedAt: "2026-06-14T00:00:00.000Z",
        },
      ],
      options: {
        preserveUpstreamRules: true,
        proxyGroups: [],
        ruleProviders: {
          custom: {
            type: "http",
            behavior: "classical",
            url: "https://example.com/custom.yaml",
            interval: 86_400,
          },
        },
        dns: null,
        matchPolicy: "PROXY",
      },
    });
    const parsed = parse(result.yaml);

    expect(parsed.proxies).toHaveLength(1);
    expect(
      parsed["proxy-groups"].map((group: { name: string }) => group.name),
    ).toEqual(["PROXY", "AUTO"]);
    expect(parsed["proxy-groups"]).not.toContainEqual(
      expect.objectContaining({ name: "Upstream" }),
    );
    expect(parsed.rules[0]).toBe("DOMAIN-SUFFIX,example.com,PROXY");
    expect(parsed.rules[1]).toBe("RULE-SET,custom,PROXY");
    expect(parsed.rules.at(-1)).toBe("MATCH,PROXY");
    expect(parsed["rule-providers"]).toHaveProperty("upstream");
    expect(parsed["rule-providers"]).toHaveProperty("custom");
    expect(parsed.dns.enable).toBe(true);
  });

  it("drops upstream rules and builds custom groups from node filters", () => {
    const result = generateClashYaml({
      sources: [
        {
          sourceName: "Filtered",
          content: `
proxies:
  - { name: US West, type: ss, server: us.example.com, port: 443 }
  - { name: HK Fast, type: ss, server: hk.example.com, port: 443 }
rules:
  - DOMAIN,upstream.example,DIRECT
  - MATCH,DIRECT
`,
        },
      ],
      rules: [
        {
          id: "custom-rule",
          ruleType: "DOMAIN-SUFFIX",
          value: "openai.com",
          policy: "OpenAI",
          enabled: true,
          sortOrder: 0,
          note: null,
          createdAt: "2026-06-15T00:00:00.000Z",
          updatedAt: "2026-06-15T00:00:00.000Z",
        },
      ],
      options: {
        preserveUpstreamRules: false,
        proxyGroups: [
          {
            name: "OpenAI",
            type: "select",
            filter: "US|United States|美",
            proxies: [],
          },
          {
            name: "Google",
            type: "url-test",
            filter: "HK|Hong Kong|港",
            proxies: [],
          },
        ],
        ruleProviders: {},
        dns: null,
        matchPolicy: "PROXY",
      },
    });
    const parsed = parse(result.yaml);
    const groups = Object.fromEntries(
      parsed["proxy-groups"].map((group: { name: string }) => [
        group.name,
        group,
      ]),
    );

    expect(parsed.rules).toEqual([
      "DOMAIN-SUFFIX,openai.com,OpenAI",
      "MATCH,PROXY",
    ]);
    expect(groups.OpenAI.proxies).toEqual(["US West"]);
    expect(groups.Google.proxies).toEqual(["HK Fast"]);
    expect(groups.Google.url).toBe("https://www.gstatic.com/generate_204");
    expect(groups.Google.filter).toBeUndefined();
  });

  it("includes every proxy when a custom group filter is empty", () => {
    const result = generateClashYaml({
      sources: [
        {
          sourceName: "All",
          content: `
proxies:
  - { name: US West, type: ss, server: us.example.com, port: 443 }
  - { name: HK Fast, type: ss, server: hk.example.com, port: 443 }
`,
        },
      ],
      rules: [],
      options: {
        preserveUpstreamRules: false,
        proxyGroups: [
          {
            name: "All Nodes",
            type: "select",
            filter: "",
            proxies: [],
          },
        ],
        ruleProviders: {},
        dns: null,
        matchPolicy: "PROXY",
      },
    });
    const parsed = parse(result.yaml);
    const allNodes = parsed["proxy-groups"].find(
      (group: { name: string }) => group.name === "All Nodes",
    );

    expect(allNodes.proxies).toEqual(["US West", "HK Fast"]);
  });
});
