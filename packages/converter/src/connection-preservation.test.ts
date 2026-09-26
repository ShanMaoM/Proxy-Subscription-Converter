import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { outputProfileOptionsSchema } from "@subscription-converter/shared";
import { generateClashYaml } from "./generate-clash-yaml";
import {
  generateBase64Subscription,
  generateSsUri,
} from "./generate-base64-subscription";
import { generateShadowrocketConfig } from "./generate-shadowrocket-config";
import { parseNodeSubscription } from "./parse-node-subscription";
import { dedupeProxies } from "./dedupe-proxies";
import type { ClashProxy } from "./parse-clash-yaml";

const node: ClashProxy = {
  name: "Plugin node",
  type: "ss",
  server: "private-node.invalid",
  port: 443,
  cipher: "aes-128-gcm",
  password: "test-password",
  plugin: "obfs",
  "plugin-opts": { mode: "http", host: "obfs.example" },
  udp: true,
};
const hosts = {
  "private-node.invalid": "192.0.2.10",
  "alias.invalid": "private-node.invalid",
  "*.example": ["192.0.2.11", "2001:db8::1"],
};
const source = {
  sourceName: "Fixture",
  content: stringify({
    proxies: [node],
    hosts,
    dns: { enable: true, "use-hosts": true },
  }),
};

describe("connection parameter preservation", () => {
  it.each([true, false])(
    "preserves hosts and every node field when preserveUpstreamRules=%s",
    (preserveUpstreamRules) => {
      const result = generateClashYaml({
        sources: [source],
        rules: [],
        options: outputProfileOptionsSchema.parse({ preserveUpstreamRules }),
      });
      const config = parse(result.yaml);
      expect(config.hosts).toEqual(hosts);
      expect(config.proxies).toEqual([node]);
      expect(config.dns["use-hosts"]).toBe(true);
    },
  );

  it("merges hosts deterministically and reports conflicting mappings", () => {
    const result = generateClashYaml({
      sources: [
        source,
        {
          sourceName: "Second",
          content: stringify({
            hosts: {
              "private-node.invalid": "192.0.2.99",
              "second.invalid": "192.0.2.12",
            },
          }),
        },
      ],
      rules: [],
      options: outputProfileOptionsSchema.parse({}),
    });
    expect(result.config.hosts).toEqual({
      ...hosts,
      "second.invalid": "192.0.2.12",
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("conflicting hosts");
  });

  it.each(["base64", "shadowrocket"])(
    "keeps obfs and uses the explicit hosts address in %s",
    (format) => {
      const result =
        format === "base64"
          ? generateBase64Subscription({ sources: [source] })
          : generateShadowrocketConfig({ sources: [source] });
      expect(result.summary.supportedCount).toBe(1);
      const output = parseNodeSubscription(result.content).proxies[0];
      const expected: ClashProxy = {
        ...node,
        server: hosts["private-node.invalid"],
      };
      delete expected.udp;
      expect(output).toEqual(expected);
      expect(output["plugin-opts"]).toEqual(node["plugin-opts"]);
    },
  );

  it("does not mistake different credentials, SNI or plugin settings for duplicates", () => {
    const result = dedupeProxies([
      node,
      { ...node, password: "other" },
      { ...node, sni: "other.invalid" },
      { ...node, "plugin-opts": { mode: "tls", host: "obfs.example" } },
      {
        ...node,
        name: "same connection",
        sourceName: "elsewhere",
        "plugin-opts": { host: "obfs.example", mode: "http" },
      },
    ]);
    expect(result.proxies).toHaveLength(4);
    expect(result.summary.duplicateCount).toBe(1);
    expect(new Set(result.proxies.map((p) => p.name)).size).toBe(4);
  });

  it("produces SIP002 plugin syntax independently of our parser", () => {
    const uri = new URL(generateSsUri(node)!);
    expect(uri.searchParams.get("plugin")).toBe(
      "obfs-local;obfs=http;obfs-host=obfs.example",
    );
    expect(uri.pathname).toBe("/");
  });

  it("preserves escaped v2ray-plugin arguments and flags", () => {
    const proxy = {
      ...node,
      plugin: "v2ray-plugin",
      "plugin-opts": {
        mode: "websocket",
        tls: true,
        host: "ws.example",
        path: "/ws;a=b:c\\d",
        mux: true,
      },
    };
    expect(
      parseNodeSubscription(generateSsUri(proxy)!).proxies[0]["plugin-opts"],
    ).toEqual(proxy["plugin-opts"]);
  });

  it("uses plaintext percent-encoded userinfo for AEAD-2022 and imports it", () => {
    const proxy = {
      ...node,
      cipher: "2022-blake3-aes-128-gcm",
      password: "abc+/=:密钥",
    };
    const uri = generateSsUri(proxy)!;
    expect(uri).toContain("ss://2022-blake3-aes-128-gcm:abc%2B%2F%3D%3A");
    expect(parseNodeSubscription(uri).proxies[0]).toMatchObject({
      cipher: proxy.cipher,
      password: proxy.password,
    });
  });

  it("skips unrepresentable plugins instead of generating broken plain SS nodes", () => {
    const result = generateBase64Subscription({
      sources: [
        {
          sourceName: "Unsupported",
          content: stringify({ proxies: [{ ...node, plugin: "shadow-tls" }] }),
        },
      ],
    });
    expect(result.summary.supportedCount).toBe(0);
    expect(result.summary.skippedCount).toBe(1);
    expect(result.warnings.join()).toContain("YAML");
    expect(result.warnings.join()).not.toContain(node.password);
  });

  it("resolves alias chains per source before deduplication and keeps TLS SNI", () => {
    const content = stringify({
      proxies: [
        {
          name: "TLS",
          type: "trojan",
          server: "alias.invalid",
          port: 443,
          password: "secret",
        },
      ],
      hosts,
    });
    const result = generateBase64Subscription({
      sources: [
        { sourceName: "one", content },
        {
          sourceName: "two",
          content: content.replace("192.0.2.10", "192.0.2.20"),
        },
      ],
    });
    const parsed = parseNodeSubscription(result.content);
    expect(parsed.proxies.map((p) => p.server)).toEqual([
      "192.0.2.10",
      "192.0.2.20",
    ]);
    expect(parsed.proxies.every((p) => p.sni === "alias.invalid")).toBe(true);
  });
});
