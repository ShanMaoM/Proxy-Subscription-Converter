import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "./app";
import { loadConfig } from "./config/env";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("server foundation", () => {
  it("does not leak subscription paths or exception stacks in request logs", async () => {
    const messages: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        messages.push(chunk.toString());
        callback();
      },
    });
    const app = await createApp({
      config: loadConfig({ NODE_ENV: "test" }),
      enableAuth: false,
      enableDatabase: false,
      logger: { stream },
    });
    apps.push(app);
    app.get("/failure", async () => {
      throw new Error(
        "Fetch https://example.com/private-secret?token=query-secret failed",
      );
    });
    await app.inject({ url: "/sub/public-token-secret/invalid/route" });
    await app.inject({ url: "/failure" });
    const output = messages.join("");
    expect(output).toContain("Request failed");
    expect(output).not.toMatch(
      /public-token-secret|private-secret|query-secret/,
    );
  });

  it("treats the empty STATIC_ROOT from the development template as unset", () => {
    expect(loadConfig({ STATIC_ROOT: "" }).STATIC_ROOT).toBeUndefined();
  });
  it("returns health status without listening on a port", async () => {
    const app = await createApp({
      config: loadConfig({ NODE_ENV: "test" }),
      enableAuth: false,
      enableDatabase: false,
      logger: false,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: { status: "ok" },
    });
  });

  it("rejects missing production secrets", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
      }),
    ).toThrow(/ADMIN_PASSWORD is required in production/);
  });

  it("serves the production SPA and preserves API 404 responses", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "subscription-web-"));
    await writeFile(join(staticRoot, "index.html"), "<h1>Production UI</h1>");
    const app = await createApp({
      config: loadConfig({ NODE_ENV: "test", STATIC_ROOT: staticRoot }),
      enableAuth: false,
      enableDatabase: false,
      logger: false,
    });
    apps.push(app);

    const root = await app.inject({
      method: "GET",
      url: "/",
      headers: { accept: "text/html" },
    });
    const clientRoute = await app.inject({
      method: "GET",
      url: "/settings",
      headers: { accept: "text/html" },
    });
    const apiRoute = await app.inject({
      method: "GET",
      url: "/api/missing",
      headers: { accept: "application/json" },
    });

    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("Production UI");
    expect(clientRoute.statusCode).toBe(200);
    expect(clientRoute.body).toContain("Production UI");
    expect(apiRoute.statusCode).toBe(404);
    expect(apiRoute.json().error.code).toBe("NOT_FOUND");
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    await rm(staticRoot, { recursive: true, force: true });
  });
});
