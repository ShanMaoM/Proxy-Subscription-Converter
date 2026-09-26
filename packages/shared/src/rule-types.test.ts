import { describe, expect, it } from "vitest";
import { createUserRuleSchema, userRuleSchema } from "./schemas";
import { ruleDefinitions } from "./rule-types";

describe("routing rule input", () => {
  it.each([
    ["IP-CIDR", "192.0.2.8", "192.0.2.8/32"],
    ["IP-CIDR6", "2001:db8::1", "2001:db8::1/128"],
    ["SRC-IP-CIDR", "2001:db8::/48", "2001:db8::/48"],
    ["NETWORK", "UDP", "udp"],
  ])(
    "normalizes %s without changing its meaning",
    (ruleType, value, expected) => {
      expect(
        createUserRuleSchema.parse({ ruleType, value, policy: "DIRECT" }).value,
      ).toBe(expected);
    },
  );
  it.each([
    ["IP-CIDR", "999.2.3.4"],
    ["IP-CIDR6", "192.0.2.1"],
    ["SRC-IP-CIDR", "10.0.0.0/33"],
    ["IP-SUFFIX", "bad"],
    ["DST-PORT", "65536"],
    ["SRC-PORT", "443-80"],
    ["IN-PORT", "0"],
    ["IP-ASN", "0"],
    ["SRC-IP-ASN", "4294967296"],
    ["DSCP", "64"],
    ["NETWORK", "icmp"],
    ["GEOIP", "China"],
    ["DOMAIN", "a.example,REJECT"],
    ["PROCESS-NAME-REGEX", "["],
    ["DOMAIN-REGEX", "(?<=a)b"],
  ])("rejects malformed %s values", (ruleType, value) => {
    expect(
      createUserRuleSchema.safeParse({ ruleType, value, policy: "DIRECT" })
        .success,
    ).toBe(false);
  });
  it("supports grouped atomic rules and DNS flags", () => {
    const examples: Record<string, string> = {
      "IP-CIDR": "192.0.2.1",
      "IP-CIDR6": "2001:db8::1",
      "SRC-IP-CIDR": "192.0.2.1",
      GEOIP: "CN",
      "RULE-SET": "my_rules",
    };
    for (const [ruleType, , , example] of ruleDefinitions) {
      expect(
        createUserRuleSchema.safeParse({
          ruleType,
          value: ruleType === "MATCH" ? null : (examples[ruleType] ?? example),
          policy: "DIRECT",
        }).success,
        ruleType,
      ).toBe(true);
    }
    expect(
      createUserRuleSchema.parse({
        ruleType: "IP-CIDR",
        value: "192.0.2.1",
        noResolve: true,
        policy: "DIRECT",
      }).noResolve,
    ).toBe(true);
    expect(
      createUserRuleSchema.safeParse({
        ruleType: "SRC-IP-CIDR",
        value: "192.0.2.1",
        noResolve: true,
        policy: "DIRECT",
      }).success,
    ).toBe(false);
    expect(
      createUserRuleSchema.safeParse({
        ruleType: "DOMAIN",
        value: "example.com",
        policy: "DIRECT,no-resolve",
      }).success,
    ).toBe(false);
    const now = new Date().toISOString();
    expect(
      userRuleSchema.parse({
        id: "old",
        ruleType: "DOMAIN",
        value: "example.com",
        policy: "DIRECT",
        enabled: true,
        sortOrder: 0,
        note: null,
        createdAt: now,
        updatedAt: now,
      }).noResolve,
    ).toBeUndefined();
  });
});
