/* global document, window */
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

import { chromium } from "playwright-core";
import { checkOutputEnhancements } from "./output-enhancements-browser.mjs";
import { checkMultiOutput } from "./multi-output-browser.mjs";
import { checkUiLayouts } from "./ui-layout-checks.mjs";

const chromePath = [
  process.env.BROWSER_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((path) => path && existsSync(path));
if (!chromePath)
  throw new Error(
    "Set BROWSER_EXECUTABLE_PATH to a Chromium browser executable",
  );
const corepackEntrypoint = join(
  dirname(process.execPath),
  "node_modules/corepack/dist/corepack.js",
);
const serverBaseUrl = "http://127.0.0.1:19100";
const webBaseUrl = "http://127.0.0.1:19101";
const workspace = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = new URL("../.tmp/screenshots/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const databaseUrl = new URL("../.tmp/browser-test.sqlite", import.meta.url);
for (const suffix of ["", "-shm", "-wal"]) {
  await rm(`${fileURLToPath(databaseUrl)}${suffix}`, { force: true });
}

const environment = {
  ...process.env,
  NODE_ENV: "development",
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "perfect-step-test",
  SESSION_SECRET: "browser-test-session-secret-with-more-than-32-characters",
  DATABASE_URL: fileURLToPath(databaseUrl),
  PORT: "19100",
  PUBLIC_BASE_URL: serverBaseUrl,
  WEB_ORIGIN: webBaseUrl,
  VITE_API_PROXY_TARGET: serverBaseUrl,
  VITE_PORT: "19101",
};

function startService(script) {
  const child = spawn(process.execPath, [corepackEntrypoint, "pnpm", script], {
    cwd: workspace,
    env: environment,
    stdio: "pipe",
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForUrl(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The development server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function stopProcessTree(child) {
  if (child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
}

const serverProcess = startService("dev:server");
const webProcess = startService("dev:web");
let browser;

try {
  await Promise.all([
    waitForUrl(`${serverBaseUrl}/health`),
    waitForUrl(webBaseUrl),
  ]);
  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(webBaseUrl, { waitUntil: "networkidle" });

  await page.getByRole("heading", { name: "登录控制台" }).waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL("step13-login.png", outputDirectory)),
    fullPage: true,
  });

  await page.getByLabel("管理员账号").fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("perfect-step-test");
  await page.getByRole("button", { name: "进入控制台" }).click();
  await page.getByRole("heading", { name: "订阅工作台" }).waitFor();
  assert.equal(
    await page.getByText("服务状态", { exact: true }).isVisible(),
    true,
  );
  await page.getByText("运行正常", { exact: true }).waitFor();
  await page.getByText("Shadowrocket（实验性）", { exact: true }).waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL("step13-dashboard.png", outputDirectory)),
    fullPage: true,
  });

  await page.getByRole("button", { name: "订阅源" }).click();
  await page.getByRole("heading", { name: "订阅源" }).waitFor();
  await page.getByRole("button", { name: "新增订阅源" }).click();
  await page.getByRole("button", { name: "粘贴 YAML" }).click();
  await page.getByLabel("名称").fill("Chrome 测试源");
  await page
    .getByLabel("YAML 内容")
    .fill(
      [
        "proxies:",
        "  - {name: US Chrome Node, type: ss, server: example.com, port: 443, cipher: aes-128-gcm, password: chrome-secret}",
        "  - {name: HK Unsupported Node, type: wireguard, server: wg.example.com, port: 443}",
        "proxy-groups:",
        "  - {name: Airport Group, type: select, proxies: [US Chrome Node]}",
        "rules:",
        "  - DOMAIN,upstream.browser.example,DIRECT",
        "  - MATCH,DIRECT",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "保存订阅源" }).click();
  await page.getByText("Chrome 测试源").waitFor();
  await page.getByRole("button", { name: "禁用 Chrome 测试源" }).click();
  await page.getByRole("button", { name: "启用 Chrome 测试源" }).waitFor();

  await page.getByRole("button", { name: "新增订阅源" }).click();
  await page.getByRole("button", { name: "粘贴 YAML" }).click();
  await page.getByLabel("名称").fill("Base64 节点源");
  await page
    .getByLabel("YAML 内容")
    .fill(
      Buffer.from(
        "ss://YWVzLTEyOC1nY206YmFzZTY0LXNlY3JldA@base64.example.com:443#Base64%20Browser%20Node",
      ).toString("base64"),
    );
  await page.getByRole("button", { name: "保存订阅源" }).click();
  await page.getByText("Base64 节点源").waitFor();

  await page.getByRole("button", { name: "新增订阅源" }).click();
  await page.getByRole("button", { name: "上传 YAML" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "uploaded-test.yaml",
    mimeType: "text/yaml",
    buffer: Buffer.from(
      "proxies:\n  - {name: Uploaded Node, type: trojan, server: upload.example.com, port: 443, password: secret}",
    ),
  });
  await page.getByText("文件已读取").waitFor();
  await page.getByRole("button", { name: "保存订阅源" }).click();
  await page.getByText("uploaded-test", { exact: true }).waitFor();

  await page.getByRole("button", { name: "新增订阅源" }).click();
  await page.getByLabel("名称").fill("受限远程源");
  await page
    .getByLabel("订阅 URL")
    .fill("http://127.0.0.1/private?token=browser-secret-token");
  await page.getByRole("button", { name: "保存订阅源" }).click();
  await page.getByText("受限远程源", { exact: true }).waitFor();
  const remoteRow = page.locator(".data-row").filter({
    hasText: "受限远程源",
  });
  await remoteRow.getByLabel("自动更新 受限远程源").selectOption("60");
  await page.waitForFunction(() => {
    const select = document.querySelector(
      'select[aria-label="自动更新 受限远程源"]',
    );
    return select?.value === "60";
  });
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /browser-secret-token/,
  );
  await page.getByRole("button", { name: "刷新 受限远程源" }).click();
  await page.getByText("Private or local addresses are not allowed").waitFor();
  await page.getByRole("button", { name: "重新载入" }).click();
  await page
    .locator(".data-row")
    .filter({ hasText: "受限远程源" })
    .getByText("失败", { exact: true })
    .waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL("step14-sources.png", outputDirectory)),
    fullPage: true,
  });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除 uploaded-test" }).click();
  await page.getByText("uploaded-test", { exact: true }).waitFor({
    state: "hidden",
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除 受限远程源" }).click();
  await page.getByText("受限远程源", { exact: true }).waitFor({
    state: "hidden",
  });

  await page.getByRole("button", { name: "规则编辑" }).click();
  await page.getByRole("heading", { name: "规则编辑" }).waitFor();
  await page.getByRole("button", { name: "新增规则" }).click();
  await page.getByLabel("规则类型").selectOption("IP-CIDR");
  await page.getByLabel("匹配值").fill("not-a-cidr");
  await page.getByRole("button", { name: "添加到草稿" }).click();
  await page
    .getByRole("alert")
    .getByText(/请输入有效的 IP 地址/)
    .waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click();

  await page.getByRole("button", { name: "新增规则" }).click();
  await page.getByLabel("匹配值").fill("example.com");
  await page.getByRole("button", { name: "添加到草稿" }).click();
  await page.getByText("example.com", { exact: true }).waitFor();

  await page.getByRole("button", { name: "新增规则" }).click();
  await page.getByLabel("规则类型").selectOption("DOMAIN");
  await page.getByLabel("匹配值").fill("two.example.com");
  await page.getByLabel("策略目标").selectOption("DIRECT");
  await page.getByRole("button", { name: "添加到草稿" }).click();
  await page.getByText("two.example.com", { exact: true }).waitFor();

  await page.getByRole("button", { name: "新增规则" }).click();
  await page.getByLabel("规则类型").selectOption("MATCH");
  await page.getByRole("button", { name: "添加到草稿" }).click();
  await page.getByText("所有剩余流量").waitFor();
  await page.getByRole("button", { name: "新增规则" }).click();
  await page.getByLabel("规则类型").selectOption("DOMAIN");
  await page.getByLabel("匹配值").fill("after-match.example.com");
  await page.getByRole("button", { name: "添加到草稿" }).click();
  await page.getByText("after-match.example.com", { exact: true }).waitFor();
  await page.getByRole("button", { name: "保存规则" }).click();
  await page.getByText("The enabled MATCH rule must be last").waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "删除 DOMAIN after-match.example.com" })
    .click();
  await page.getByText("after-match.example.com", { exact: true }).waitFor({
    state: "hidden",
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除 MATCH PROXY" }).click();
  await page.getByText("所有剩余流量").waitFor({ state: "hidden" });

  const initialTwoRuleRow = page
    .locator(".rule-row")
    .filter({ has: page.getByText("two.example.com", { exact: true }) });
  const initialExampleRuleRow = page
    .locator(".rule-row")
    .filter({ has: page.getByText("example.com", { exact: true }) });
  await initialTwoRuleRow.dragTo(initialExampleRuleRow, {
    targetPosition: { x: 12, y: 4 },
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".rule-value strong")?.textContent ===
      "two.example.com",
  );
  const ruleValues = await page.locator(".rule-value strong").allTextContents();
  assert.deepEqual(ruleValues, ["two.example.com", "example.com"]);
  const exampleRuleRow = page
    .locator(".rule-row")
    .filter({ has: page.getByText("example.com", { exact: true }) });
  const twoRuleRow = page
    .locator(".rule-row")
    .filter({ has: page.getByText("two.example.com", { exact: true }) });
  await exampleRuleRow.dragTo(twoRuleRow, {
    targetPosition: { x: 12, y: 4 },
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".rule-value strong")?.textContent ===
      "example.com",
  );
  const draggedRuleValues = await page
    .locator(".rule-value strong")
    .allTextContents();
  assert.deepEqual(draggedRuleValues, ["example.com", "two.example.com"]);
  await page
    .getByRole("button", {
      name: "禁用 DOMAIN-SUFFIX example.com",
    })
    .click();
  await page
    .getByRole("button", {
      name: "启用 DOMAIN-SUFFIX example.com",
    })
    .waitFor();
  await page.getByRole("button", { name: "保存规则" }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some(
      (button) => button.textContent?.trim() === "保存规则" && button.disabled,
    ),
  );
  await page.screenshot({
    path: fileURLToPath(new URL("step15-rules.png", outputDirectory)),
    fullPage: true,
  });

  await page.getByRole("button", { name: "订阅源" }).click();
  await page.getByRole("button", { name: "启用 Chrome 测试源" }).click();
  await page.getByRole("button", { name: "禁用 Chrome 测试源" }).waitFor();
  await page.getByRole("button", { name: "输出预览" }).click();
  await page.getByRole("heading", { name: "订阅输出" }).waitFor();
  await page.getByText("最终节点").waitFor();
  const yamlPreview = await page.locator(".yaml-panel pre code").textContent();
  assert.match(yamlPreview ?? "", /Base64 Browser Node/);
  assert.match(yamlPreview ?? "", /DOMAIN,two\.example\.com,DIRECT/);
  assert.doesNotMatch(yamlPreview ?? "", /DOMAIN-SUFFIX,example\.com,PROXY/);
  await page.getByPlaceholder("clash.yaml").fill("browser-nodes.txt");
  await page.getByRole("button", { name: "保存设置" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".output-link-panel code")
      ?.textContent?.includes("browser-nodes.txt"),
  );
  const base64SubscriptionUrl =
    (await page.locator(".output-link-panel code").textContent()) ?? "";
  const base64SubscriptionResponse = await fetch(base64SubscriptionUrl);
  assert.equal(base64SubscriptionResponse.status, 200);
  assert.equal(
    base64SubscriptionResponse.headers.get("content-disposition"),
    'inline; filename="browser-nodes.txt"',
  );
  assert.match(
    Buffer.from(await base64SubscriptionResponse.text(), "base64").toString(
      "utf8",
    ),
    /Base64%20Browser%20Node|Base64 Browser Node/,
  );
  await page.getByRole("button", { name: "复制链接" }).click();
  await page.getByRole("button", { name: "已复制" }).waitFor();
  await page.getByRole("button", { name: "重新生成" }).click();
  await page.getByRole("button", { name: "重新生成" }).waitFor();
  await page.getByPlaceholder("clash.yaml").fill("clash.yaml");
  await page.getByRole("button", { name: "保存设置" }).click();
  await page.getByText("最终节点", { exact: true }).waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 YAML" }).click();
  const download = await downloadPromise;
  const downloadPath = fileURLToPath(
    new URL("downloaded-clash.yaml", outputDirectory),
  );
  await download.saveAs(downloadPath);
  assert.equal(download.suggestedFilename(), "clash.yaml");
  assert.match(await readFile(downloadPath, "utf8"), /MATCH,PROXY/);
  await page.screenshot({
    path: fileURLToPath(new URL("step16-output.png", outputDirectory)),
    fullPage: true,
  });

  await page
    .getByRole("combobox", { name: "当前输出", exact: true })
    .selectOption("default-shadowrocket");
  await page.getByText("支持节点", { exact: true }).waitFor();
  assert.equal(
    await page
      .locator(".summary-card")
      .filter({ hasText: "支持节点" })
      .locator("strong")
      .textContent(),
    "2",
  );
  assert.equal(
    await page
      .locator(".summary-card")
      .filter({ hasText: "跳过节点" })
      .locator("strong")
      .textContent(),
    "1",
  );
  assert.match(
    (await page.locator(".yaml-panel pre code").textContent()) ?? "",
    /^ss:\/\//,
  );
  await page.getByRole("button", { name: "复制链接" }).click();
  await page.getByRole("button", { name: "已复制" }).waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL("step17-shadowrocket.png", outputDirectory)),
    fullPage: true,
  });
  await page
    .getByRole("combobox", { name: "当前输出", exact: true })
    .selectOption("default-clash");
  await page.getByRole("switch", { name: "保留上游规则" }).click();
  await page.getByRole("button", { name: "添加策略组" }).click();
  await page.getByLabel("策略组 1 名称").fill("OpenAI");
  await page.getByLabel("策略组 1 过滤正则").fill("US|United States|美");
  await page.getByRole("button", { name: "添加策略组" }).click();
  await page.getByLabel("策略组 2 名称").fill("Google");
  await page.getByLabel("策略组 2 类型").selectOption("url-test");
  await page.getByLabel("策略组 2 过滤正则").fill("HK|Hong Kong|港");
  await page.getByRole("button", { name: "添加规则集" }).click();
  await page.getByLabel("规则集 1 名称").fill("gfw_list");
  await page.getByLabel("规则集 1 行为").selectOption("classical");
  await page.getByLabel("规则集 1 链接").fill("https://example.com/gfw.yaml");
  await page.getByRole("button", { name: "添加规则集" }).click();
  await page.getByLabel("规则集 2 名称").fill("temporary");
  await page
    .getByLabel("规则集 2 链接")
    .fill("https://example.com/temporary.yaml");
  await page.getByRole("button", { name: "删除规则集 temporary" }).click();
  await page.getByRole("button", { name: "保存设置" }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[role="switch"][aria-label="保留上游规则"]')
        ?.getAttribute("aria-checked") === "false" &&
      document.querySelector("button.primary-button") !== null,
  );
  await page.waitForFunction(() => {
    const yaml = document.querySelector(".yaml-panel pre code")?.textContent;
    return (
      yaml?.includes("name: OpenAI") &&
      yaml.includes("name: Google") &&
      yaml.includes("gfw_list:") &&
      !yaml.includes("upstream.browser.example")
    );
  });
  let configuredYaml =
    (await page.locator(".yaml-panel pre code").textContent()) ?? "";
  assert.match(configuredYaml, /name: OpenAI[\s\S]*US Chrome Node/);
  assert.match(configuredYaml, /name: Google[\s\S]*HK Unsupported Node/);
  assert.match(
    configuredYaml,
    /gfw_list:[\s\S]*behavior: classical[\s\S]*interval: 86400/,
  );
  assert.doesNotMatch(configuredYaml, /temporary:/);
  assert.doesNotMatch(configuredYaml, /upstream\.browser\.example/);
  assert.doesNotMatch(configuredYaml, /name: Airport Group/);

  await page.getByRole("button", { name: "规则编辑" }).click();
  await page.getByRole("button", { name: "新增规则" }).click();
  await page.getByLabel("匹配值").fill("openai.com");
  await page.getByLabel("策略目标").selectOption("OpenAI");
  await page.getByRole("button", { name: "添加到草稿" }).click();
  await page.getByText("openai.com", { exact: true }).waitFor();
  await page.getByRole("button", { name: "新增规则" }).click();
  await page.getByLabel("规则类型").selectOption("RULE-SET");
  assert.equal(await page.getByLabel("匹配值").inputValue(), "gfw_list");
  await page.getByRole("button", { name: "添加到草稿" }).click();
  await page.getByText("gfw_list", { exact: true }).waitFor();
  await page.getByRole("button", { name: "编辑 RULE-SET gfw_list" }).click();
  assert.equal(
    await page.getByLabel("匹配值").evaluate((field) => field.tagName),
    "SELECT",
  );
  assert.equal(await page.getByLabel("匹配值").inputValue(), "gfw_list");
  await page.getByRole("button", { name: "更新草稿" }).click();
  await page
    .getByRole("button", { name: "编辑 DOMAIN two.example.com" })
    .click();
  await page.getByLabel("策略目标").selectOption("Google");
  await page.getByRole("button", { name: "更新草稿" }).click();
  await page
    .locator(".rule-row")
    .filter({ hasText: "two.example.com" })
    .getByText("Google", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "保存规则" }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some(
      (button) => button.textContent?.trim() === "保存规则" && button.disabled,
    ),
  );

  await page.getByRole("button", { name: "输出预览" }).click();
  await page.getByRole("heading", { name: "订阅输出" }).waitFor();
  await page.waitForFunction(() => {
    const yaml = document.querySelector(".yaml-panel pre code")?.textContent;
    return (
      yaml?.includes("DOMAIN-SUFFIX,openai.com,OpenAI") &&
      yaml.includes("DOMAIN,two.example.com,Google") &&
      yaml.includes("RULE-SET,gfw_list,PROXY")
    );
  });
  configuredYaml =
    (await page.locator(".yaml-panel pre code").textContent()) ?? "";
  assert.match(configuredYaml, /DOMAIN-SUFFIX,openai\.com,OpenAI/);
  assert.match(configuredYaml, /DOMAIN,two\.example\.com,Google/);
  assert.match(configuredYaml, /RULE-SET,gfw_list,PROXY/);
  assert.doesNotMatch(configuredYaml, /upstream\.browser\.example/);
  await page.screenshot({
    path: fileURLToPath(new URL("step20-output-groups.png", outputDirectory)),
    fullPage: true,
  });

  await page.getByRole("button", { name: "系统维护" }).click();
  await page.getByRole("heading", { name: "系统维护" }).waitFor();
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /browser-secret-token/,
  );
  const backupDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 JSON 备份" }).click();
  const backupDownload = await backupDownloadPromise;
  const backupPath = fileURLToPath(
    new URL("step19-configuration-backup.json", outputDirectory),
  );
  await backupDownload.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  assert.equal(backup.version, 1);
  assert.equal(backup.sources.length, 2);
  assert.equal(backup.rules.length, 4);
  assert.equal(backup.outputProfiles.length, 2);

  await page
    .locator('.backup-picker input[type="file"]')
    .setInputFiles(backupPath);
  await page.getByText("step19-configuration-backup.json").waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "恢复所选备份" }).click();
  await page.getByText(/已恢复 2 个订阅源、4 条规则和 2 个输出配置/).waitFor();
  await page.getByText("Configuration backup restored").waitFor();
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /browser-secret-token/,
  );
  await page.screenshot({
    path: fileURLToPath(new URL("step19-system.png", outputDirectory)),
    fullPage: true,
  });

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(webBaseUrl, {
    waitUntil: "networkidle",
  });
  await mobilePage.getByLabel("管理员账号").fill("admin");
  await mobilePage
    .getByLabel("密码", { exact: true })
    .fill("perfect-step-test");
  await mobilePage.getByRole("button", { name: "进入控制台" }).click();
  await mobilePage.getByRole("heading", { name: "订阅工作台" }).waitFor();
  await mobilePage.getByRole("button", { name: "打开导航" }).click();
  await mobilePage.getByRole("button", { name: "订阅源" }).click();
  await mobilePage.getByRole("heading", { name: "订阅源" }).waitFor();
  await mobilePage.waitForFunction(
    () => !document.querySelector(".nav-list.nav-open"),
  );
  await mobilePage.waitForFunction(
    () => document.documentElement.scrollWidth === window.innerWidth,
  );
  await mobilePage.screenshot({
    path: fileURLToPath(new URL("step20-sources-mobile.png", outputDirectory)),
    fullPage: true,
  });
  await mobilePage.getByRole("button", { name: "打开导航" }).click();
  await mobilePage.getByRole("button", { name: "输出预览" }).click();
  await mobilePage.getByRole("heading", { name: "订阅输出" }).waitFor();
  await mobilePage.getByText("规则与策略组").waitFor();
  await mobilePage.getByText("规则集管理（Rule Providers）").waitFor();
  await mobilePage.waitForFunction(
    () => !document.querySelector(".nav-list.nav-open"),
  );
  await mobilePage.screenshot({
    path: fileURLToPath(new URL("step20-mobile.png", outputDirectory)),
    fullPage: true,
  });
  await mobileContext.close();

  await checkMultiOutput(page, outputDirectory);
  await checkOutputEnhancements(page, outputDirectory);
  await checkUiLayouts(page, outputDirectory);

  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("heading", { name: "登录控制台" }).waitFor();
  assert.deepEqual(pageErrors, [], "No unhandled browser errors");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
    await page.screenshot({
      path: fileURLToPath(new URL(`ui-login-${width}.png`, outputDirectory)),
      fullPage: true,
    });
  }
  console.log(
    "Chromium smoke test passed: existing management flows, multiple outputs, access records and responsive layouts",
  );
} finally {
  await browser?.close();
  stopProcessTree(serverProcess);
  stopProcessTree(webProcess);
}
