import { describe, expect, it } from "vitest";

import { ClashYamlParseError, parseClashYaml } from "./parse-clash-yaml";

describe("parseClashYaml", () => {
  it("parses Clash proxies, groups, rules, providers and dns", () => {
    const result = parseClashYaml(`
proxies:
  - name: Tokyo
    type: ss
    server: jp.example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: PROXY
    type: select
    proxies: [Tokyo, DIRECT]
rule-providers:
  ads:
    type: http
    behavior: domain
    url: https://example.com/ads.yaml
dns:
  enable: true
  nameserver: [1.1.1.1]
rules:
  - DOMAIN-SUFFIX,example.com,PROXY
  - MATCH,DIRECT
`);

    expect(result.proxies).toHaveLength(1);
    expect(result.proxyGroups).toHaveLength(1);
    expect(result.rules).toHaveLength(2);
    expect(result.ruleProviders.ads?.behavior).toBe("domain");
    expect(result.dns?.enable).toBe(true);
  });

  it("reports invalid YAML clearly", () => {
    expect(() => parseClashYaml("proxies: [")).toThrow(ClashYamlParseError);
  });

  it("tolerates missing proxies", () => {
    expect(parseClashYaml("rules: []").proxies).toEqual([]);
  });

  it("detects duplicate node names", () => {
    const result = parseClashYaml(`
proxies:
  - { name: Same, type: ss, server: one.example.com, port: 443 }
  - { name: Same, type: ss, server: two.example.com, port: 443 }
`);
    expect(result.duplicateProxyNames).toEqual(["Same"]);
  });
});
