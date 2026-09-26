/* global document, window */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

export async function checkUiLayouts(page, outputDirectory) {
  const pages = [
    ["仪表盘", "订阅工作台", "dashboard"],
    ["订阅源", "订阅源", "sources"],
    ["规则编辑", "规则编辑", "rules"],
    ["输出预览", "订阅输出", "output"],
    ["系统维护", "系统维护", "system"],
  ];
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    for (const [navigation, heading, file] of pages) {
      if (width <= 833)
        await page.getByRole("button", { name: "打开导航" }).click();
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", { name: navigation, exact: true })
        .click();
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        clippedControls: [
          ...document.querySelectorAll("button, input, select, textarea"),
        ]
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return (
              rect.width > 0 &&
              (rect.right > window.innerWidth + 1 || rect.left < -1)
            );
          })
          .map((node) => node.getAttribute("aria-label") || node.textContent),
      }));
      assert.equal(overflow.document, width, `${file} overflows at ${width}px`);
      assert.deepEqual(
        overflow.clippedControls,
        [],
        `${file} controls clipped at ${width}px`,
      );
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: fileURLToPath(
            new URL(`ui-${file}-${width}.png`, outputDirectory),
          ),
          fullPage: true,
        });
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("button", { name: "打开导航" })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.getByRole("button", { name: "打开导航" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "订阅源", exact: true })
    .click();
  await page.getByRole("button", { name: "新增订阅源" }).click();
  const dialog = page.getByRole("dialog", { name: "新增订阅源" });
  await dialog.waitFor();
  for (let step = 0; step < 14; step++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await dialog.evaluate((node) => node.contains(document.activeElement)),
      true,
      "Modal must contain keyboard focus",
    );
  }
  await page.screenshot({
    path: fileURLToPath(new URL("ui-source-dialog-390.png", outputDirectory)),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  assert.equal(await dialog.count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "新增订阅源" })
      .evaluate((node) => node === document.activeElement),
    true,
  );

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.route("**/health", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: { message: "Test unavailable" },
      }),
    }),
  );
  await page.reload();
  await page.getByText("连接异常", { exact: true }).waitFor();
  await page.unroute("**/health");
  await page.reload();
  await page.getByText("运行正常", { exact: true }).waitFor();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "输出预览" })
    .click();
  await page.getByRole("button", { name: "复制链接", exact: true }).waitFor();
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async () => {
        throw new Error("Test clipboard denied");
      },
    }),
  );
  await page.getByRole("button", { name: "复制链接", exact: true }).click();
  await page
    .getByRole("alert")
    .getByText("无法访问剪贴板，请选中订阅地址后手动复制。")
    .waitFor();
  await page.reload();
  console.log(
    "UI checks passed: 25 page/viewport combinations, mobile menu, modal focus/Escape, health failure, clipboard failure",
  );
}
