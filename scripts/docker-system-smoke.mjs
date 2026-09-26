import assert from "node:assert/strict";

const baseUrl = process.env.DOCKER_TEST_BASE_URL ?? "http://127.0.0.1:18080";
const password = process.env.DOCKER_TEST_PASSWORD;

if (!password) {
  throw new Error("DOCKER_TEST_PASSWORD is required");
}

const marker = Date.now().toString(36);
const sourceName = `Docker System Source ${marker}`;
const secret = `system-secret-${marker}`;
const remoteUrl = `https://example.com/sub/${secret}?token=${secret}`;

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

const cookie = await login();
const created = await request("/api/sources", cookie, {
  method: "POST",
  body: JSON.stringify({
    name: sourceName,
    type: "remote_url",
    url: remoteUrl,
    enabled: true,
    note: "Step 19 Docker system smoke test",
  }),
});
assert.doesNotMatch(JSON.stringify(created), new RegExp(secret));

const backup = await request("/api/system/backup", cookie);
assert.equal(backup.version, 1);
assert.equal(
  backup.sources.some(
    (source) => source.id === created.id && source.url === remoteUrl,
  ),
  true,
  "Backup did not include the recoverable remote URL",
);

const restored = await request("/api/system/restore", cookie, {
  method: "POST",
  body: JSON.stringify(backup),
});
assert.equal(restored.sources, backup.sources.length);
assert.equal(restored.rules, backup.rules.length);

const sources = await request("/api/sources", cookie);
const restoredSource = sources.find((source) => source.id === created.id);
assert.ok(restoredSource, "Restored source was not found");
assert.match(restoredSource.urlMasked, /\*\*\*/);
assert.doesNotMatch(JSON.stringify(restoredSource), new RegExp(secret));

const logs = await request("/api/system/logs?limit=200", cookie);
assert.equal(
  logs.some((entry) => entry.action === "backup.restore"),
  true,
  "Restore operation was not logged",
);
assert.doesNotMatch(JSON.stringify(logs), new RegExp(secret));

await request(`/api/sources/${created.id}`, cookie, { method: "DELETE" });
console.log(
  `Docker system smoke passed: backup v${backup.version}, ${restored.sources} sources, ${restored.rules} rules`,
);
