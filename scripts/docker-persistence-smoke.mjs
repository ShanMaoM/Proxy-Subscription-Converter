import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const baseUrl = process.env.DOCKER_TEST_BASE_URL ?? "http://127.0.0.1:18080";
const password = process.env.DOCKER_TEST_PASSWORD;
const projectName = process.env.DOCKER_TEST_PROJECT ?? "url-step18";

if (!password) {
  throw new Error("DOCKER_TEST_PASSWORD is required");
}

const marker = Date.now().toString(36);
const sourceName = `Docker Persistent Source ${marker}`;
const ruleValue = `${marker}.docker-persistence.example`;

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
  if (!response.ok) {
    throw new Error(`Login failed: ${await response.text()}`);
  }
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "Login response did not contain a session cookie");
  return cookie;
}

async function request(path, cookie, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
      cookie,
    },
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${await response.text()}`);
  }
  if (response.status === 204) return undefined;
  return (await response.json()).data;
}

async function waitForHealth() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The container may still be restarting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Docker application did not become healthy after restart");
}

const cookie = await login();
await request("/api/sources", cookie, {
  method: "POST",
  body: JSON.stringify({
    name: sourceName,
    type: "pasted_yaml",
    rawContent: "proxies: []",
    enabled: true,
    note: "Step 18 persistence smoke test",
  }),
});
await request("/api/rules", cookie, {
  method: "POST",
  body: JSON.stringify({
    ruleType: "DOMAIN",
    value: ruleValue,
    policy: "DIRECT",
    enabled: true,
    note: "Step 18 persistence smoke test",
  }),
});

execFileSync("docker", ["compose", "-p", projectName, "restart", "app"], {
  cwd: new URL("../", import.meta.url),
  stdio: "inherit",
});
await waitForHealth();

const cookieAfterRestart = await login();
const sources = await request("/api/sources", cookieAfterRestart);
const rules = await request("/api/rules", cookieAfterRestart);

assert.equal(
  sources.some((source) => source.name === sourceName),
  true,
  "Subscription source did not survive the container restart",
);
assert.equal(
  rules.some((rule) => rule.value === ruleValue),
  true,
  "Rule did not survive the container restart",
);

console.log(`Docker persistence smoke passed: ${sourceName}, ${ruleValue}`);
