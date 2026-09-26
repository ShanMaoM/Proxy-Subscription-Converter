import { describe, expect, it } from "vitest";

import { generateShadowrocketConfig } from "./generate-shadowrocket-config";
import { parseNodeSubscription } from "./parse-node-subscription";

describe("generateShadowrocketConfig", () => {
  it("preserves VMess WebSocket settings and Trojan TLS/transport fields", () => {
    const result = generateShadowrocketConfig({
      sources: [
        {
          sourceName: "Transport",
          content: `
proxies:
  - name: VMess
    type: vmess
    server: example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    network: ws
    tls: true
    ws-opts: {path: /socket, headers: {Host: ws.example.com}}
  - name: Trojan
    type: trojan
    server: tr.example.com
    port: 443
    password: secret
    servername: tls.example.com
    skip-cert-verify: true
    network: ws
    ws-opts: {path: /trojan}
`,
        },
      ],
    });
    const parsed = parseNodeSubscription(result.content);
    expect(parsed.proxies[0]["ws-opts"]).toEqual({
      path: "/socket",
      headers: { Host: "ws.example.com" },
    });
    expect(parsed.proxies[1]).toMatchObject({
      servername: "tls.example.com",
      "skip-cert-verify": true,
      network: "ws",
    });
  });
  it("generates importable SS, Trojan and VMess URIs", () => {
    const result = generateShadowrocketConfig({
      sources: [
        {
          sourceName: "Supported",
          content: `
proxies:
  - { name: SS, type: ss, server: ss.example.com, port: 443, cipher: aes-128-gcm, password: secret }
  - { name: Trojan, type: trojan, server: tr.example.com, port: 443, password: secret, sni: tr.example.com }
  - { name: VMess, type: vmess, server: vm.example.com, port: 443, uuid: 11111111-1111-1111-1111-111111111111, tls: true }
`,
        },
      ],
    });

    expect(result.content.split("\n")[0]).toMatch(/^ss:\/\//);
    expect(result.content).toContain("trojan://");
    expect(result.content).toContain("vmess://");
    expect(result.summary.supportedCount).toBe(3);
  });

  it("skips unsupported or incomplete nodes without throwing", () => {
    const result = generateShadowrocketConfig({
      sources: [
        {
          sourceName: "Mixed",
          content: `
proxies:
  - { name: WireGuard, type: wireguard, server: wg.example.com, port: 443 }
  - { name: Missing Password, type: ss, server: ss.example.com, port: 443, cipher: aes-128-gcm }
`,
        },
      ],
    });

    expect(result.content).toBe("");
    expect(result.summary.skippedCount).toBe(2);
    expect(result.summary.unsupportedTypes).toEqual(["ss", "wireguard"]);
  });
});
