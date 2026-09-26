import { describe, expect, it } from "vitest";

import { generateBase64Subscription } from "./generate-base64-subscription";

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64(value: string) {
  const normalized = value.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base64");
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return decodeURIComponent(
    bytes.map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""),
  );
}

describe("generateBase64Subscription", () => {
  it("encodes deduplicated proxy URIs as a base64 node subscription", () => {
    const result = generateBase64Subscription({
      sources: [
        {
          sourceName: "Mixed",
          content: `
proxies:
  - name: Reality Node
    type: vless
    server: reality.example.com
    port: 443
    uuid: 22222222-2222-2222-2222-222222222222
    tls: true
    servername: www.example.com
    client-fingerprint: chrome
    reality-opts:
      public-key: public-key-value
      short-id: abcd
  - name: HY2 Hop
    type: hysteria2
    server: hy.example.com
    port: 8443
    password: secret
    ports: 20000-20100
`,
        },
      ],
    });
    const decoded = decodeBase64(result.content);

    expect(result.summary.supportedCount).toBe(2);
    expect(decoded).toContain("vless://");
    expect(decoded).toContain("security=reality");
    expect(decoded).toContain("pbk=public-key-value");
    expect(decoded).toContain("sid=abcd");
    expect(decoded).toContain("fp=chrome");
    expect(decoded).toContain("hysteria2://");
    expect(decoded).toContain("ports=20000-20100");
    expect(decoded).toContain("mport=20000-20100");
  });
});
