import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../packages/converter/package.json", import.meta.url),
);
const { parse } = require("yaml");

const baseUrl = process.env.DOCKER_TEST_BASE_URL ?? "http://127.0.0.1:18080";
const password = process.env.DOCKER_TEST_PASSWORD;
const projectName = process.env.DOCKER_TEST_PROJECT ?? "url-step20";

if (!password) {
  throw new Error("DOCKER_TEST_PASSWORD is required");
}

const marker = Date.now().toString(36);
const sourceName = `Step 20 Docker Source ${marker}`;
const proxyName = `Step20-US-${marker}`;
const base64ProxyName = `Step20-Base64-${marker}`;
const groupName = `Step20-Group-${marker}`;
const ruleProviderName = "step_provider";
const upstreamGroupName = `Upstream-Group-${marker}`;
const upstreamDomain = `upstream-${marker}.example`;

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
      // The application may still be restarting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Docker application did not become healthy after restart");
}

let cookie = await login();
const profiles = await request("/api/output/profiles", cookie);
const clashProfile = profiles.find(
  (profile) => profile.targetClient === "clash",
);
assert.ok(clashProfile, "Clash output profile was not found");

let source;
let base64Source;
let scheduledSource;
try {
  source = await request("/api/sources", cookie, {
    method: "POST",
    body: JSON.stringify({
      name: sourceName,
      type: "pasted_yaml",
      rawContent: `
proxies:
  - { name: ${proxyName}, type: ss, server: ${marker}.example.com, port: 443, cipher: aes-128-gcm, password: test }
proxy-groups:
  - { name: ${upstreamGroupName}, type: select, proxies: [${proxyName}] }
rules:
  - DOMAIN,${upstreamDomain},DIRECT
  - MATCH,DIRECT
`,
      enabled: true,
      note: "Temporary Step 20 Docker output smoke source",
    }),
  });
  base64Source = await request("/api/sources", cookie, {
    method: "POST",
    body: JSON.stringify({
      name: `Step 20 Base64 Source ${marker}`,
      type: "pasted_yaml",
      rawContent: Buffer.from(
        `ss://YWVzLTEyOC1nY206YmFzZTY0LWRvY2tlcg@base64-${marker}.example.com:443#${encodeURIComponent(
          base64ProxyName,
        )}`,
      ).toString("base64"),
      enabled: true,
      note: "Temporary Step 20 Base64 output smoke source",
    }),
  });
  scheduledSource = await request("/api/sources", cookie, {
    method: "POST",
    body: JSON.stringify({
      name: `Step 20 Scheduled Source ${marker}`,
      type: "remote_url",
      url: `https://example.com/sub/${marker}`,
      enabled: true,
      refreshIntervalMinutes: 60,
      note: "Temporary Step 20 automatic refresh smoke source",
    }),
  });
  assert.equal(scheduledSource.refreshIntervalMinutes, 60);
  assert.ok(scheduledSource.nextRefreshAt);
  scheduledSource = await request(
    `/api/sources/${scheduledSource.id}`,
    cookie,
    {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    },
  );

  const updatedProfile = await request(
    `/api/output/profiles/${clashProfile.id}`,
    cookie,
    {
      method: "PATCH",
      body: JSON.stringify({
        options: {
          ...clashProfile.options,
          preserveUpstreamRules: false,
          proxyGroups: [
            ...clashProfile.options.proxyGroups,
            {
              name: groupName,
              type: "select",
              filter: `^${proxyName}$`,
            },
          ],
          ruleProviders: {
            ...clashProfile.options.ruleProviders,
            [ruleProviderName]: {
              behavior: "classical",
              url: `https://example.com/rules/${marker}.yaml`,
            },
          },
        },
      }),
    },
  );
  assert.equal(
    updatedProfile.options.ruleProviders[ruleProviderName].type,
    "http",
  );
  assert.equal(
    updatedProfile.options.ruleProviders[ruleProviderName].interval,
    86_400,
  );

  execFileSync("docker", ["compose", "-p", projectName, "restart", "app"], {
    cwd: new URL("../", import.meta.url),
    stdio: "inherit",
  });
  await waitForHealth();
  cookie = await login();

  const persistedProfiles = await request("/api/output/profiles", cookie);
  const persistedProfile = persistedProfiles.find(
    (profile) => profile.id === clashProfile.id,
  );
  assert.equal(
    persistedProfile.options.ruleProviders[ruleProviderName].url,
    `https://example.com/rules/${marker}.yaml`,
  );

  const preview = await request(
    `/api/output/preview/${clashProfile.id}`,
    cookie,
  );
  const yaml = parse(preview.yaml);
  const group = yaml["proxy-groups"].find(
    (candidate) => candidate.name === groupName,
  );

  assert.deepEqual(group?.proxies, [proxyName]);
  assert.equal(
    yaml.proxies.some((proxy) => proxy.name === base64ProxyName),
    true,
    "Base64 URI subscription node was not included in generated YAML",
  );
  assert.deepEqual(yaml["rule-providers"][ruleProviderName], {
    behavior: "classical",
    interval: 86_400,
    type: "http",
    url: `https://example.com/rules/${marker}.yaml`,
  });
  assert.equal(
    yaml.rules.some((rule) => rule.includes(upstreamDomain)),
    false,
    "Upstream rule was preserved after it was disabled",
  );
  assert.equal(
    yaml["proxy-groups"].some((candidate) => "filter" in candidate),
    false,
    "Management-only filter leaked into generated YAML",
  );
  assert.equal(
    yaml["proxy-groups"].some(
      (candidate) => candidate.name === upstreamGroupName,
    ),
    false,
    "Imported subscription group was preserved",
  );
  const publicToken = new URL(clashProfile.subscriptionUrl).pathname.split(
    "/",
  )[2];
  const publicYaml = await fetch(
    `${baseUrl}/sub/${publicToken}/docker-custom-${marker}.yaml`,
  );
  assert.equal(publicYaml.status, 200);
  assert.equal(
    publicYaml.headers.get("content-disposition"),
    `inline; filename="docker-custom-${marker}.yaml"`,
  );
  assert.match(await publicYaml.text(), new RegExp(base64ProxyName));
  const publicBase64 = await fetch(
    `${baseUrl}/sub/${publicToken}/docker-nodes-${marker}.txt`,
  );
  assert.equal(publicBase64.status, 200);
  assert.equal(
    publicBase64.headers.get("content-disposition"),
    `inline; filename="docker-nodes-${marker}.txt"`,
  );
  assert.match(
    Buffer.from(await publicBase64.text(), "base64").toString("utf8"),
    new RegExp(encodeURIComponent(base64ProxyName)),
  );

  console.log(
    `Docker output smoke passed: ${groupName} matched ${proxyName}; Base64 node ${base64ProxyName} rendered in YAML and txt output; ${ruleProviderName} persisted; imported groups and upstream rules were removed`,
  );
} finally {
  await request(`/api/output/profiles/${clashProfile.id}`, cookie, {
    method: "PATCH",
    body: JSON.stringify({ options: clashProfile.options }),
  });
  if (source) {
    await request(`/api/sources/${source.id}`, cookie, { method: "DELETE" });
  }
  if (base64Source) {
    await request(`/api/sources/${base64Source.id}`, cookie, {
      method: "DELETE",
    });
  }
  if (scheduledSource) {
    await request(`/api/sources/${scheduledSource.id}`, cookie, {
      method: "DELETE",
    });
  }
}
