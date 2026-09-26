import { describe, expect, it, vi } from "vitest";
import { createPinnedLookup } from "./safe-address";

import {
  fetchRemoteSubscription,
  isBlockedAddress,
  parseSubscriptionUserInfo,
} from "./fetch-subscription";

const publicResolver = async () => ["93.184.216.34"];

describe("safe remote subscription fetching", () => {
  it("pins connection lookups to the addresses validated before connecting", () => {
    const lookup = createPinnedLookup("example.com", ["93.184.216.34"]);
    const callback = vi.fn();
    lookup("example.com", { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [
      { address: "93.184.216.34", family: 4 },
    ]);
    lookup("example.com", { family: 4 }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, "93.184.216.34", 4);
    lookup("other.example", {}, callback);
    expect(callback.mock.lastCall?.[0]).toBeInstanceOf(Error);
    expect(() => createPinnedLookup("example.com", ["127.0.0.1"])).toThrow();
  });

  it.each([
    "::ffff:7f00:1",
    "0:0:0:0:0:0:0:1",
    "::ffff:192.168.1.1",
    "fe80::1",
    "2002:7f00:1::",
    "198.51.100.1",
  ])("blocks special address %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it("accepts global IPv6 literals without attempting DNS resolution", async () => {
    const resolveHost = vi.fn();
    const result = await fetchRemoteSubscription(
      "https://[2606:4700:4700::1111]/sub",
      {
        resolveHost,
        fetchImpl: vi.fn(async () => new Response("proxies: []")),
      },
    );
    expect(result.content).toBe("proxies: []");
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it("rejects redirects to local addresses and cancels the redirect body", async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          status: 302,
          headers: { location: "http://[::ffff:7f00:1]/secret" },
        }),
    );
    await expect(
      fetchRemoteSubscription("https://example.com/sub", {
        fetchImpl,
        resolveHost: publicResolver,
      }),
    ).rejects.toThrow(/Private or local/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalled();
  });

  it("times out stalled response bodies and DNS resolution", async () => {
    const cancel = vi.fn();
    await expect(
      fetchRemoteSubscription("https://example.com/sub", {
        resolveHost: publicResolver,
        timeoutMs: 30,
        fetchImpl: vi.fn(
          async () => new Response(new ReadableStream({ cancel })),
        ),
      }),
    ).rejects.toThrow(/timed out/);
    expect(cancel).toHaveBeenCalled();
    const fetchImpl = vi.fn();
    await expect(
      fetchRemoteSubscription("https://example.com/sub", {
        resolveHost: () => new Promise(() => {}),
        timeoutMs: 30,
        fetchImpl,
      }),
    ).rejects.toThrow(/timed out/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignores malformed traffic and unrepresentable expiration dates", () => {
    expect(
      parseSubscriptionUserInfo(
        "upload=1.5; download=-1; total=Infinity; expire=99999999999999",
      ),
    ).toEqual({
      upload: null,
      download: null,
      total: null,
      expireAt: null,
    });
  });
  it("rejects non-HTTP protocols and loopback addresses", async () => {
    await expect(fetchRemoteSubscription("file:///secret")).rejects.toThrow(
      /Only HTTP and HTTPS/,
    );
    await expect(
      fetchRemoteSubscription("http://127.0.0.1/sub"),
    ).rejects.toThrow(/Private or local/);
    expect(isBlockedAddress("10.0.0.1")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
  });

  it("rejects oversized responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("x".repeat(20)));
    await expect(
      fetchRemoteSubscription("https://example.com/sub", {
        fetchImpl,
        maxBytes: 10,
        resolveHost: publicResolver,
      }),
    ).rejects.toThrow(/size limit/);
  });

  it("parses subscription-userinfo response headers", async () => {
    const metadata = parseSubscriptionUserInfo(
      "upload=1073741824; download=2147483648; total=10737418240; expire=1782777600",
    );
    expect(metadata).toEqual({
      upload: 1_073_741_824,
      download: 2_147_483_648,
      total: 10_737_418_240,
      expireAt: new Date("2026-06-30T00:00:00.000Z"),
    });

    const fetchImpl = vi.fn(
      async () =>
        new Response("proxies: []", {
          headers: {
            "subscription-userinfo":
              "upload=1; download=2; total=10; expire=1782777600",
          },
        }),
    );
    const result = await fetchRemoteSubscription("https://example.com/sub", {
      fetchImpl,
      resolveHost: publicResolver,
    });
    expect(typeof result).toBe("object");
    expect(
      typeof result === "object" && result.subscriptionUserInfo,
    ).toMatchObject({
      upload: 1,
      download: 2,
      total: 10,
    });
  });

  it("reports HTTP errors without including the URL", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    const request = fetchRemoteSubscription(
      "https://example.com/private-token",
      {
        fetchImpl,
        resolveHost: publicResolver,
      },
    );
    await expect(request).rejects.toThrow("Remote server returned HTTP 404");
    await expect(request).rejects.not.toThrow(/private-token/);
  });
});
