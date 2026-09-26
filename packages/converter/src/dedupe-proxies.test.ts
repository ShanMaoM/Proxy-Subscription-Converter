import { describe, expect, it } from "vitest";

import { dedupeProxies } from "./dedupe-proxies";
import type { ClashProxy } from "./parse-clash-yaml";

function proxy(overrides: Partial<ClashProxy> = {}): ClashProxy {
  return {
    name: "Node",
    type: "ss",
    server: "one.example.com",
    port: 443,
    ...overrides,
  };
}

describe("dedupeProxies", () => {
  it("keeps one proxy for identical connections with different display names", () => {
    const result = dedupeProxies([
      proxy(),
      proxy({ name: "Different display name" }),
    ]);

    expect(result.proxies).toHaveLength(1);
    expect(result.summary.duplicateCount).toBe(1);
  });

  it("renames different proxies that share a name", () => {
    const result = dedupeProxies([
      proxy({ sourceName: "Airport A" }),
      proxy({ server: "two.example.com", sourceName: "Airport B" }),
    ]);

    expect(result.proxies.map((item) => item.name)).toEqual([
      "Node",
      "Node [Airport B]",
    ]);
    expect(result.summary.renamedCount).toBe(1);
  });

  it("reports input, duplicate and final counts", () => {
    const result = dedupeProxies([
      proxy(),
      proxy(),
      proxy({ server: "two.example.com" }),
    ]);

    expect(result.summary).toEqual({
      inputCount: 3,
      duplicateCount: 1,
      renamedCount: 1,
      finalCount: 2,
    });
  });
});
