import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isIP } from "node:net";

const base = process.env.DOCKER_TEST_BASE_URL;
const project = process.env.DOCKER_TEST_PROJECT;
const password = process.env.DOCKER_TEST_PASSWORD;
if (!base || !project?.startsWith("url-multi-test-") || !password)
  throw new Error(
    "Use an isolated url-multi-test-* Compose project and set DOCKER_TEST_BASE_URL / DOCKER_TEST_PASSWORD",
  );
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];
async function api(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      cookie,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `Management request returned ${response.status}`);
  return response.status === 204 ? undefined : (await response.json()).data;
}
const profile = await api("/api/output/profiles", "POST", {
  name: "Docker isolated output",
  targetClient: "clash",
  options: { sourceIds: [], customRules: [], matchPolicy: "DIRECT" },
});
const url = `${base}${new URL(profile.subscriptionUrl).pathname}`;
try {
  const response = await fetch(url, {
    headers: { "x-forwarded-for": "203.0.113.77", "x-real-ip": "203.0.113.88" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(await response.text(), /MATCH,DIRECT/);
  const records = await api(`/api/output/profiles/${profile.id}/access-logs`);
  assert.equal(records.total, 1);
  assert.ok(isIP(records.items[0].ip));
  assert.notEqual(records.items[0].ip, "203.0.113.77");
  assert.notEqual(records.items[0].ip, "203.0.113.88");
  execFileSync("docker", ["restart", `${project}-app-1`], {
    stdio: "ignore",
    windowsHide: true,
  });
  const deadline = Date.now() + 45_000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/health`)).ok) {
        healthy = true;
        break;
      }
    } catch {
      /* restarting */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(healthy);
  const profiles = await api("/api/output/profiles");
  assert.equal(
    profiles.find((item) => item.id === profile.id).subscriptionUrl,
    profile.subscriptionUrl,
  );
  assert.deepEqual(
    (await api(`/api/output/profiles/${profile.id}/access-logs`)).items,
    records.items,
  );
  console.log(
    "Docker multi-output passed: Caddy rejects forged IP headers, records real peer, profile/token/logs persist across restart.",
  );
} finally {
  await api(`/api/output/profiles/${profile.id}`, "DELETE");
}
