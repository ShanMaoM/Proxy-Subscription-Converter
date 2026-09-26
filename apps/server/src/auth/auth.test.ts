import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../app";
import { loadConfig } from "../config/env";
import {
  sessionCookieName,
  createSessionToken,
  verifySessionToken,
} from "./session";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
const config = loadConfig({
  NODE_ENV: "test",
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "correct-password",
  SESSION_SECRET: "test-session-secret-that-is-longer-than-32-chars",
  DATABASE_URL: ":memory:",
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("single administrator authentication", () => {
  it("rejects sessions for a previous administrator username", async () => {
    const token = await createSessionToken(config, "previous-admin");
    await expect(verifySessionToken(config, token)).rejects.toThrow(
      /Invalid session/,
    );
  });
  it("protects management routes", async () => {
    const app = await createApp({ config, logger: false });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/sources" });

    expect(response.statusCode).toBe(401);
  });

  it("logs in, resolves the session, and logs out", async () => {
    const app = await createApp({ config, logger: false });
    apps.push(app);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "correct-password",
      },
    });
    const cookie = login.cookies.find(
      (item) => item.name === sessionCookieName,
    );

    expect(login.statusCode).toBe(200);
    expect(cookie?.httpOnly).toBe(true);

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: {
        [sessionCookieName]: cookie!.value,
      },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.username).toBe("admin");

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: {
        [sessionCookieName]: cookie!.value,
      },
    });
    expect(logout.statusCode).toBe(200);
    expect(
      logout.cookies.find((item) => item.name === sessionCookieName)?.value,
    ).toBe("");

    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/sources",
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("rejects an incorrect password without echoing it", async () => {
    const app = await createApp({ config, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "definitely-wrong",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain("definitely-wrong");
  });
});
