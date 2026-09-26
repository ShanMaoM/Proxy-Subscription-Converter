import { describe, expect, it } from "vitest";
import {
  outputProfileOptionsSchema,
  nodeFilterSchema,
} from "@subscription-converter/shared";
import { generateClashYaml } from "./generate-clash-yaml";
import { generateBase64Subscription } from "./generate-base64-subscription";
import { generateShadowrocketConfig } from "./generate-shadowrocket-config";

const sources = [
  {
    sourceName: "One",
    content: `proxies:
  - {name: HK Expired, type: ss, server: same.example, port: 443, cipher: aes-128-gcm, password: secret}
  - {name: HK Fast, type: ss, server: same.example, port: 443, cipher: aes-128-gcm, password: secret}
  - {name: JP Fast, type: trojan, server: jp.example, port: 443, password: secret}
  - {name: US Node, type: ss, server: us.example, port: 443, cipher: aes-128-gcm, password: secret}
`,
  },
];
describe("per-output node filters", () => {
  it("applies inclusion, exclusion and protocols before deduplication in all formats", () => {
    const nodeFilter = nodeFilterSchema.parse({
      includeKeywords: ["hk", "JP"],
      excludeKeywords: ["expired"],
      protocols: ["ss"],
    });
    const yaml = generateClashYaml({
      sources,
      rules: [],
      options: outputProfileOptionsSchema.parse({
        nodeFilter,
        proxyGroups: [
          {
            name: "Filtered",
            type: "select",
            proxies: ["HK Expired", "US Node"],
          },
        ],
      }),
    });
    expect(yaml.summary).toMatchObject({
      inputCount: 4,
      filteredCount: 3,
      duplicateCount: 0,
      finalCount: 1,
    });
    expect(yaml.config.proxies).toMatchObject([{ name: "HK Fast" }]);
    expect(yaml.config["proxy-groups"]).toContainEqual({
      name: "Filtered",
      type: "select",
      proxies: ["HK Fast"],
    });
    expect(yaml.yaml).not.toMatch(/HK Expired|JP Fast|US Node/);
    const text = generateBase64Subscription({ sources, nodeFilter });
    const conf = generateShadowrocketConfig({ sources, nodeFilter });
    expect(text.plainText).toBe(conf.content);
    expect(conf.content).toContain("HK%20Fast");
    expect(text.summary).toMatchObject({ filteredCount: 3, supportedCount: 1 });
    expect(
      generateClashYaml({
        sources,
        rules: [],
        options: outputProfileOptionsSchema.parse({}),
      }).summary.finalCount,
    ).toBe(3);
  });
  it("distinguishes all protocols from an explicit empty selection", () => {
    const options = outputProfileOptionsSchema.parse({
      nodeFilter: { protocols: [] },
    });
    const yaml = generateClashYaml({ sources, rules: [], options });
    expect(yaml.summary.finalCount).toBe(0);
    expect(yaml.summary.filteredCount).toBe(4);
    expect(
      generateBase64Subscription({ sources, nodeFilter: options.nodeFilter })
        .content,
    ).toBe("");
    expect(
      generateShadowrocketConfig({ sources, nodeFilter: options.nodeFilter })
        .content,
    ).toBe("");
  });
});
