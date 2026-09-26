import { describe, expect, it } from "vitest";

import { generateClashYaml } from "./generate-clash-yaml";
import { parseNodeSubscription } from "./parse-node-subscription";
import { parseSubscriptionContent } from "./parse-subscription-content";
import { generateBase64Subscription } from "./generate-base64-subscription";

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(value: string) {
  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }

  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const block = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    result += alphabet[(block >> 18) & 63];
    result += alphabet[(block >> 12) & 63];
    result += second === undefined ? "=" : alphabet[(block >> 6) & 63];
    result += third === undefined ? "=" : alphabet[block & 63];
  }
  return result;
}

describe("parseNodeSubscription", () => {
  it("keeps valid nodes when another URI contains malformed encoding or JSON", () => {
    const result = parseNodeSubscription(
      [
        "trojan://secret@example.com:443#%invalid",
        "ss://YWVzLTEyOC1nY206c2VjcmV0@invalid-host:99999",
        `vmess://${base64("null")}`,
        "trojan://secret@good.example.com:443#Good",
      ].join("\n"),
    );
    expect(result.proxies).toHaveLength(1);
    expect(result.proxies[0].name).toBe("Good");
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.join(" ")).not.toContain("secret");
  });

  it("does not mistake YAML values containing URI schemes for node subscriptions", () => {
    const result = parseSubscriptionContent(
      'proxies:\n  - { name: "ss://label", type: trojan, server: example.com, port: 443, password: secret }',
    );
    expect(result.proxies).toHaveLength(1);
    expect(result.proxies[0].type).toBe("trojan");
  });

  it("round trips IPv6 nodes without doubling address brackets", () => {
    const content = "trojan://secret@[2606:4700:4700::1111]:443#IPv6";
    expect(parseNodeSubscription(content).proxies[0].server).toBe(
      "2606:4700:4700::1111",
    );
    const output = generateBase64Subscription({
      sources: [{ sourceName: "IPv6", content }],
    });
    expect(output.plainText).toContain("@[2606:4700:4700::1111]:443");
    expect(parseNodeSubscription(output.content).proxies).toHaveLength(1);
  });
  it("decodes base64 URI subscriptions into Clash proxies", () => {
    const vmessPayload = base64(
      JSON.stringify({
        v: "2",
        ps: "VMess Demo",
        add: "vmess.example.com",
        port: "443",
        id: "11111111-1111-1111-1111-111111111111",
        aid: "0",
        net: "ws",
        path: "/ws",
        host: "vmess.example.com",
        tls: "tls",
      }),
    );
    const subscription = base64(
      [
        "ss://YWVzLTEyOC1nY206c2VjcmV0@ss.example.com:443#SS%20Demo",
        `vmess://${vmessPayload}`,
        "trojan://password@trojan.example.com:443?sni=trojan.example.com#Trojan%20Demo",
        "vless://22222222-2222-2222-2222-222222222222@vless.example.com:443?security=tls&type=ws&path=/ws#VLESS%20Demo",
        "hysteria2://hy-secret@hy.example.com:8443?sni=hy.example.com#HY2%20Demo",
      ].join("\n"),
    );

    const result = parseNodeSubscription(subscription);

    expect(result.proxies.map((proxy) => proxy.type)).toEqual([
      "ss",
      "vmess",
      "trojan",
      "vless",
      "hysteria2",
    ]);
    expect(result.proxies[0]).toMatchObject({
      name: "SS Demo",
      server: "ss.example.com",
      port: 443,
      cipher: "aes-128-gcm",
      password: "secret",
    });
    expect(result.proxies[3]).toMatchObject({
      name: "VLESS Demo",
      tls: true,
      network: "ws",
    });
  });

  it("preserves VLESS Reality, fingerprint and Hysteria2 advanced params", () => {
    const result = parseNodeSubscription(
      [
        "vless://22222222-2222-2222-2222-222222222222@reality.example.com:443?security=reality&type=tcp&sni=www.example.com&fp=chrome&pbk=public-key-value&sid=abcd&allowInsecure=true#Reality%20Node",
        "hysteria2://secret@hy.example.com:8443?sni=hy.example.com&ports=20000-20100&insecure=1#HY2%20Hop",
      ].join("\n"),
    );

    expect(result.proxies[0]).toMatchObject({
      name: "Reality Node",
      type: "vless",
      tls: true,
      servername: "www.example.com",
      "client-fingerprint": "chrome",
      "skip-cert-verify": true,
      "reality-opts": {
        "public-key": "public-key-value",
        "short-id": "abcd",
      },
    });
    expect(result.proxies[1]).toMatchObject({
      name: "HY2 Hop",
      type: "hysteria2",
      ports: "20000-20100",
      mport: "20000-20100",
      "skip-cert-verify": true,
    });
  });

  it("lets URI subscriptions participate in output dedupe and groups", () => {
    const result = generateClashYaml({
      sources: [
        {
          sourceName: "URI",
          content: base64(
            [
              "ss://YWVzLTEyOC1nY206c2VjcmV0@us.example.com:443#US%20One",
              "ss://YWVzLTEyOC1nY206c2VjcmV0@us.example.com:443#US%20Duplicate",
            ].join("\n"),
          ),
        },
      ],
      rules: [],
      options: {
        preserveUpstreamRules: false,
        proxyGroups: [
          {
            name: "US",
            type: "select",
            filter: "US",
            proxies: [],
          },
        ],
        ruleProviders: {},
        dns: null,
        matchPolicy: "PROXY",
      },
    });

    expect(result.summary.inputCount).toBe(2);
    expect(result.summary.duplicateCount).toBe(1);
    expect(result.config.proxies).toHaveLength(1);
    expect(result.yaml).toContain("name: US");
  });
});
