/* global document */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

export async function checkMultiOutput(page, outputDirectory) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "输出预览" })
    .click();
  const originalUrl = await page
    .locator(".output-link-panel code")
    .textContent();
  await page.getByRole("button", { name: "新增输出", exact: true }).click();
  await page
    .getByRole("textbox", { name: "输出名称", exact: true })
    .fill("仅手机使用");
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/output/profiles") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "创建输出" }).click();
  const created = (await (await createdResponse).json()).data;
  await page
    .getByRole("heading", { name: "仅手机使用", exact: true })
    .waitFor();
  const phoneUrl = await page.locator(".output-link-panel code").textContent();
  assert.notEqual(phoneUrl, originalUrl);
  await page.getByLabel("订阅来源").selectOption("selected");
  await page
    .getByRole("checkbox", { name: "Chrome 测试源", exact: true })
    .uncheck();
  await page.getByLabel("自定义规则", { exact: true }).selectOption("custom");
  // Saving scope must not discard a draft in the separate settings panel.
  await page.getByPlaceholder("clash.yaml").fill("phone.yaml");
  await page.getByRole("button", { name: "保存使用范围" }).click();
  await page.getByRole("button", { name: "编辑独立规则" }).waitFor();
  assert.equal(
    await page.getByPlaceholder("clash.yaml").inputValue(),
    "phone.yaml",
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("combobox", { name: "当前输出", exact: true })
    .selectOption("default-clash");
  assert.equal(
    await page
      .getByRole("combobox", { name: "当前输出", exact: true })
      .inputValue(),
    created.id,
  );
  await page.getByRole("button", { name: "保存设置" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".output-link-panel code")
      ?.textContent?.endsWith("phone.yaml"),
  );
  await page.getByRole("button", { name: "编辑独立规则" }).click();
  await page.getByRole("heading", { name: "仅手机使用的规则" }).waitFor();
  await page.locator(".rule-row").first().waitFor();
  while (await page.locator(".rule-row").count()) {
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(".rule-row button.danger").first().click();
  }
  await page.getByRole("button", { name: "新增规则" }).click();
  await page.getByLabel("匹配值").fill("phone.example.com");
  await page.getByLabel("策略目标").selectOption("DIRECT");
  await page.getByRole("button", { name: "添加到草稿" }).click();
  await page.getByRole("button", { name: "保存规则" }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (button) => button.textContent.trim() === "保存规则" && button.disabled,
    ),
  );
  await page.getByRole("button", { name: "返回输出" }).click();
  await page.getByText("最终节点", { exact: true }).waitFor();
  const content = await page.locator(".yaml-panel pre code").textContent();
  assert.match(content, /Base64 Browser Node/);
  assert.match(content, /DOMAIN-SUFFIX,phone\.example\.com,DIRECT/);
  assert.doesNotMatch(content, /US Chrome Node|openai.com|two.example.com/);
  const url = await page.locator(".output-link-panel code").textContent();
  assert.equal((await fetch(url)).status, 200);
  await page.getByRole("button", { name: "刷新记录" }).click();
  await page
    .locator(".access-row code")
    .filter({ hasText: "127.0.0.1" })
    .waitFor();
  await page.getByRole("switch", { name: "启用当前输出" }).click();
  await page
    .getByText("链接已停用。客户端无法获取订阅，仍可在这里调整配置和预览。")
    .waitFor();
  assert.equal((await fetch(url)).status, 404);
  await page.getByRole("button", { name: "刷新记录" }).click();
  await page.locator(".access-row").getByText("404 失败").waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL("multi-output-desktop.png", outputDirectory)),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  await page.screenshot({
    path: fileURLToPath(new URL("multi-output-mobile.png", outputDirectory)),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("switch", { name: "启用当前输出" }).click();
  await page.getByRole("button", { name: "修改名称" }).click();
  await page
    .getByRole("textbox", { name: "输出名称", exact: true })
    .fill("手机独立输出");
  await page.getByRole("button", { name: "保存名称" }).click();
  await page
    .getByRole("heading", { name: "手机独立输出", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".output-link-panel code").textContent(),
    url,
  );
  await page
    .getByRole("combobox", { name: "当前输出", exact: true })
    .selectOption("default-clash");
  await page.getByText("最终节点", { exact: true }).waitFor();
  assert.equal(
    await page.locator(".output-link-panel code").textContent(),
    originalUrl,
  );
  assert.match(
    await page.locator(".yaml-panel pre code").textContent(),
    /openai.com/,
  );
  assert.doesNotMatch(
    await page.locator(".yaml-panel pre code").textContent(),
    /phone.example.com/,
  );
  await page
    .getByRole("combobox", { name: "当前输出", exact: true })
    .selectOption(created.id);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "重置公开 token" }).click();
  await page.waitForFunction(
    (old) =>
      document.querySelector(".output-link-panel code")?.textContent !== old,
    url,
  );
  assert.equal((await fetch(url)).status, 404);
  const resetUrl = await page.locator(".output-link-panel code").textContent();
  assert.equal((await fetch(resetUrl)).status, 200);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除输出", exact: true }).click();
  await page
    .getByRole("heading", { name: "Clash / Mihomo", exact: true })
    .waitFor();
  assert.equal((await fetch(resetUrl)).status, 404);
  console.log(
    "Multi-output browser checks passed: independent sources/rules, draft protection, rename, disable, IP records, token reset and deletion",
  );
}
