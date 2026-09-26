/* global document, CSS */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

export async function checkOutputEnhancements(page, outputDirectory) {
  await page.getByRole("button", { name: "新增输出", exact: true }).click();
  await page
    .getByRole("textbox", { name: "输出名称", exact: true })
    .fill("筛选与 IP 规则验证");
  await page.getByLabel("输出格式").selectOption("txt");
  await page.getByRole("button", { name: "创建输出" }).click();
  await page
    .getByRole("heading", { name: "筛选与 IP 规则验证", exact: true })
    .waitFor();
  await page.getByLabel("保留名称关键词").fill("US");
  await page.getByLabel("排除名称关键词").fill("Unsupported");
  await page.getByLabel("节点协议", { exact: true }).selectOption("selected");
  await page.getByLabel("保留协议", { exact: true }).fill("ss");
  await page.getByRole("button", { name: "保存使用范围" }).click();
  await page
    .getByText("1 个输出节点，筛选排除 2 个。", { exact: true })
    .waitFor();
  const readOutput = () => page.locator(".yaml-panel pre code").textContent();
  await page.waitForFunction(
    () => document.querySelector(".summary-card strong")?.textContent === "1",
  );
  assert.match(
    Buffer.from(await readOutput(), "base64").toString(),
    /US%20Chrome%20Node/,
  );
  const url = await page.locator(".output-link-panel code").textContent();
  assert.equal(await (await fetch(url)).text(), await readOutput());
  await page.getByLabel("保留名称关键词").fill("does-not-exist");
  await page.getByRole("button", { name: "保存使用范围" }).click();
  await page.getByText("没有输出节点", { exact: true }).waitFor();
  await page.getByLabel("保留名称关键词").fill("US");
  await page.getByLabel("自定义规则", { exact: true }).selectOption("custom");
  await page.getByRole("button", { name: "保存使用范围" }).click();
  await page.getByRole("button", { name: "编辑独立规则" }).click();
  await page
    .getByRole("heading", { name: "筛选与 IP 规则验证的规则" })
    .waitFor();
  await page.locator(".rule-row").first().waitFor();
  while (await page.locator(".rule-row").count()) {
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(".rule-row button.danger").first().click();
  }
  await page.getByRole("button", { name: "新增规则" }).click();
  await page.getByLabel("规则类型").selectOption("IP-CIDR");
  assert.equal(
    await page.evaluate(() => CSS.supports("appearance", "base-select")),
    true,
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByLabel("规则类型").click();
    await page.screenshot({
      path: fileURLToPath(
        new URL(`select-rules-${width}.png`, outputDirectory),
      ),
    });
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .getByRole("dialog", { name: "规则编辑", exact: true })
        .isVisible(),
      true,
      "Escape closes picker before the dialog",
    );
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByLabel("匹配值", { exact: true }).fill("192.0.2.300");
  await page.getByRole("button", { name: "添加到草稿" }).click();
  await page
    .getByRole("alert")
    .getByText(/请输入有效的 IP 地址/)
    .waitFor();
  await page.getByLabel("匹配值", { exact: true }).fill("192.0.2.8");
  await page.getByLabel("策略目标").selectOption("DIRECT");
  await page.getByRole("checkbox", { name: /不触发 DNS/ }).check();
  await page.getByRole("button", { name: "添加到草稿" }).click();
  await page.getByText("192.0.2.8/32", { exact: true }).waitFor();
  for (const [type, value] of [
    ["IP-CIDR6", "2001:db8::8"],
    ["SRC-IP-CIDR", "192.168.1.0/24"],
    ["DST-PORT", "80/443/8000-9000"],
    ["NETWORK", "udp"],
  ]) {
    await page.getByRole("button", { name: "新增规则" }).click();
    await page.getByLabel("规则类型").selectOption(type);
    if (type === "NETWORK")
      await page.getByLabel("匹配值", { exact: true }).selectOption(value);
    else await page.getByLabel("匹配值", { exact: true }).fill(value);
    await page.getByLabel("策略目标").selectOption("DIRECT");
    await page.getByRole("button", { name: "添加到草稿" }).click();
  }
  await page.getByRole("button", { name: "保存规则" }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (button) => button.textContent.trim() === "保存规则" && button.disabled,
    ),
  );
  await page.getByRole("button", { name: "返回输出" }).click();
  await page.getByPlaceholder("clash.yaml").fill("filtered.yaml");
  await page.getByRole("button", { name: "保存设置" }).click();
  await page.getByText("可以生成 YAML 订阅。", { exact: true }).waitFor();
  await page.getByText("最终节点", { exact: true }).waitFor();
  const yaml = await readOutput();
  assert.match(yaml, /IP-CIDR,192.0.2.8\/32,DIRECT,no-resolve/);
  assert.match(yaml, /IP-CIDR6,2001:db8::8\/128,DIRECT/);
  assert.match(yaml, /SRC-IP-CIDR,192.168.1.0\/24,DIRECT/);
  assert.match(yaml, /DST-PORT,80\/443\/8000-9000,DIRECT/);
  assert.match(yaml, /NETWORK,udp,DIRECT/);
  assert.doesNotMatch(yaml, /Base64 Browser Node|HK Unsupported Node/);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.evaluate(() => document.documentElement.scrollTo(0, 0));
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
    await page.screenshot({
      path: fileURLToPath(
        new URL(`output-checks-${width}.png`, outputDirectory),
      ),
      fullPage: true,
    });
  }
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除输出", exact: true }).click();
  await page
    .getByRole("heading", { name: "Clash / Mihomo", exact: true })
    .waitFor();
  assert.match(await readOutput(), /Base64 Browser Node/);
  console.log(
    "Enhanced output UI passed: styled dropdowns and Escape, filters/real downloads, availability states, IPv4/IPv6/source IP/ports/network and DNS flag.",
  );
}
