import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import dgram from "node:dgram";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { generateClashYaml } from "../packages/converter/src/index.ts";
import { outputProfileOptionsSchema } from "../packages/shared/src/index.ts";
const require = createRequire(
  new URL("../apps/server/package.json", import.meta.url),
);
const { stringify } = require("yaml");
const binary =
  process.env.MIHOMO_BIN ?? "C:/Program Files/Clash Verge/verge-mihomo.exe";
assert(
  fs.existsSync(binary),
  "Set MIHOMO_BIN to the installed Mihomo executable",
);
const temporaryRoot = fileURLToPath(new URL("../.tmp/", import.meta.url));
fs.mkdirSync(temporaryRoot, { recursive: true });
const directory = fs.mkdtempSync(path.join(temporaryRoot, "converter-core-"));
const socket = dgram.createSocket("udp4");
await new Promise((resolve) => socket.bind(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const dns = {
  enable: true,
  listen: `127.0.0.1:${port}`,
  ipv6: false,
  "use-hosts": true,
  "use-system-hosts": false,
  "enhanced-mode": "redir-host",
  nameserver: ["udp://127.0.0.1:9"],
  "default-nameserver": ["127.0.0.1"],
};
const output = generateClashYaml({
  sources: [
    {
      sourceName: "Offline fixture",
      content: stringify({
        proxies: [
          {
            name: "SS obfs",
            type: "ss",
            server: "node.connection-test.invalid",
            port: 443,
            cipher: "aes-128-gcm",
            password: "test-password",
            plugin: "obfs",
            "plugin-opts": { mode: "http", host: "obfs.invalid" },
          },
        ],
        hosts: { "node.connection-test.invalid": "192.0.2.10" },
        dns,
      }),
    },
  ],
  rules: [],
  options: outputProfileOptionsSchema.parse({
    preserveUpstreamRules: false,
    matchPolicy: "DIRECT",
    proxyGroups: [
      { name: "PROXY", type: "select", proxies: [] },
      { name: "AUTO", type: "select", proxies: [] },
    ],
  }),
});
// No upstream resolvers, public test URLs, TUN, system proxy or geodata rules.
const file = path.join(directory, "config.yaml");
fs.writeFileSync(
  file,
  stringify({ ...output.config, "log-level": "silent", "allow-lan": false }),
);
const validation = spawnSync(binary, ["-t", "-d", directory, "-f", file], {
  windowsHide: true,
  encoding: "utf8",
  timeout: 15000,
});
assert.equal(
  validation.status,
  0,
  "Mihomo rejected the synthetic generated configuration",
);
console.log("Mihomo accepted generated SS obfs configuration.");
const child = spawn(binary, ["-d", directory, "-f", file], {
  windowsHide: true,
  stdio: "ignore",
});
let spawnError;
child.on("error", (error) => {
  spawnError = error;
});
function query() {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket("udp4");
    const header = Buffer.from([
      0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0,
    ]);
    const labels = "node.connection-test.invalid"
      .split(".")
      .map((s) => Buffer.concat([Buffer.from([s.length]), Buffer.from(s)]));
    const packet = Buffer.concat([
      header,
      ...labels,
      Buffer.from([0, 0, 1, 0, 1]),
    ]);
    const timer = setTimeout(() => {
      client.close();
      reject(new Error("Local DNS timeout"));
    }, 500);
    client.on("message", (answer) => {
      clearTimeout(timer);
      client.close();
      resolve(answer);
    });
    client.on("error", (error) => {
      clearTimeout(timer);
      client.close();
      reject(error);
    });
    client.send(packet, port, "127.0.0.1");
  });
}
try {
  let answer;
  for (let attempt = 0; attempt < 12; attempt++) {
    if (spawnError) throw spawnError;
    try {
      answer = await query();
      break;
    } catch {
      if (child.exitCode !== null)
        throw new Error("Mihomo exited before DNS verification");
    }
  }
  assert(answer, "No local DNS response");
  assert.equal(answer[3] & 15, 0, "Generated hosts did not resolve");
  assert(answer.readUInt16BE(6) > 0, "Missing DNS answer");
  assert(
    answer.includes(Buffer.from([192, 0, 2, 10])),
    "Hosts address not found in local DNS response",
  );
  console.log(
    "Mihomo DNS resolved the generated hosts mapping to 192.0.2.10 entirely on loopback.",
  );
} finally {
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
}
