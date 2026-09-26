import { timingSafeEqual } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";

import type { AppConfig } from "../config/env";

export const sessionCookieName = "admin_session";

function getSessionSecret(config: AppConfig) {
  if (!config.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required to enable authentication");
  }

  return new TextEncoder().encode(config.SESSION_SECRET);
}

export function verifyPassword(input: string, expected: string) {
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);

  if (inputBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(inputBuffer, expectedBuffer);
}

export async function createSessionToken(config: AppConfig, username: string) {
  return new SignJWT({ username, role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(getSessionSecret(config));
}

export async function verifySessionToken(config: AppConfig, token: string) {
  const result = await jwtVerify(token, getSessionSecret(config), {
    algorithms: ["HS256"],
  });
  const username = result.payload.username;

  if (
    result.payload.role !== "admin" ||
    typeof username !== "string" ||
    username !== config.ADMIN_USERNAME ||
    result.payload.sub !== config.ADMIN_USERNAME
  ) {
    throw new Error("Invalid session");
  }

  return { username };
}
