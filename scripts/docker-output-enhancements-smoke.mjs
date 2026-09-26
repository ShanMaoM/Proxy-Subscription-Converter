import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const base = process.env.DOCKER_TEST_BASE_URL,
  project = process.env.DOCKER_TEST_PROJECT;
if (!base || !project?.startsWith("url-multi-test-"))
  throw new Error("Use isolated DOCKER_TEST_* settings");
const login = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    username: "admin",
    password: process.env.DOCKER_TEST_PASSWORD,
  }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];
async function api(path, method = "GET", body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      cookie,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(r.ok, `API ${method} ${path}: ${r.status}`);
  return (await r.json()).data;
}
const file = new URL(
  "../.tmp/output-enhancements-upgrade.json",
  import.meta.url,
);
if (process.argv[2] === "seed") {
  fs.mkdirSync(new URL("../.tmp/", import.meta.url), { recursive: true });
  const source = await api("/api/sources", "POST", {
    name: "Upgrade fixture",
    type: "pasted_yaml",
    rawContent:
      "proxies:\n  - {name: HK One, type: ss, server: hk.example, port: 443, cipher: aes-128-gcm, password: test}\n  - {name: US One, type: ss, server: us.example, port: 443, cipher: aes-128-gcm, password: test}",
  });
  const rule = await api("/api/rules", "POST", {
    ruleType: "IP-CIDR",
    value: "192.0.2.0/24",
    policy: "DIRECT",
  });
  const profile = (await api("/api/output/profiles")).find(
    (p) => p.id === "default-clash",
  );
  fs.writeFileSync(file, JSON.stringify({ source, rule, profile }));
  console.log(
    "Old Docker image seeded with source, IP rule and existing subscription token.",
  );
} else {
  const old = JSON.parse(fs.readFileSync(file, "utf8"));
  const profile = (await api("/api/output/profiles")).find(
    (p) => p.id === "default-clash",
  );
  assert.equal(profile.subscriptionUrl, old.profile.subscriptionUrl);
  assert.equal((await api("/api/rules"))[0].noResolve, false);
  assert.equal((await api("/api/sources"))[0].id, old.source.id);
  await api("/api/output/profiles/default-clash", "PATCH", {
    options: { ...profile.options, nodeFilter: { includeKeywords: ["HK"] } },
  });
  await api("/api/rules/" + old.rule.id, "PATCH", {
    value: "192.0.2.8",
    noResolve: true,
  });
  const availability = await api(
    "/api/output/profiles/default-clash/availability",
  );
  assert.equal(availability.state, "ready");
  assert.equal(availability.nodeCount, 1);
  const content = await (
    await fetch(base + new URL(profile.subscriptionUrl).pathname)
  ).text();
  assert.match(content, /HK One/);
  assert.doesNotMatch(content, /US One/);
  assert.match(content, /IP-CIDR,192.0.2.8\/32,DIRECT,no-resolve/);
  execFileSync("docker", ["restart", `${project}-app-1`], {
    stdio: "ignore",
    windowsHide: true,
  });
  const deadline = Date.now() + 45000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(base + "/health")).ok) {
        healthy = true;
        break;
      }
    } catch {
      // The application may be restarting between health requests.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(healthy);
  assert.equal(
    (await api("/api/output/profiles/default-clash/availability")).nodeCount,
    1,
  );
  assert.equal((await api("/api/rules"))[0].noResolve, true);
  console.log(
    "Docker upgrade passed: old sources/rules/token preserved; node filter, availability, single-IP normalization and DNS flag persist across restart.",
  );
}
