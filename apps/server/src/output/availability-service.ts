import { outputProfileOptionsSchema } from "@subscription-converter/shared";
import { OutputRepository } from "./repository";
import { OutputService, OutputNotReadyError } from "./service";

type Check = {
  key: string;
  title: string;
  status: "ok" | "warning" | "error";
  message: string;
};
export class OutputAvailabilityService {
  constructor(private readonly repository: OutputRepository) {}
  check(profileId: string) {
    const profile = this.repository.findProfile(profileId);
    if (!profile) return undefined;
    const options = outputProfileOptionsSchema.parse(
      JSON.parse(profile.optionsJson),
    );
    const all = this.repository.listSources();
    const selectedIds =
      options.sourceIds == null ? null : new Set(options.sourceIds);
    const selected = all.filter((source) =>
      selectedIds ? selectedIds.has(source.id) : source.enabled,
    );
    const missingCount = selectedIds
      ? [...selectedIds].filter((id) => !all.some((source) => source.id === id))
          .length
      : 0;
    const checks: Check[] = [
      {
        key: "enabled",
        title: "订阅链接",
        status: profile.enabled ? "ok" : "error",
        message: profile.enabled
          ? "已启用，客户端可以请求此链接。"
          : "已停用，公开请求返回 404。",
      },
    ];
    if (missingCount)
      checks.push({
        key: "missing",
        title: "来源已删除",
        status: "warning",
        message: `${missingCount} 个所选来源已删除，请重新检查使用范围。`,
      });
    const sources = selected.map((source) => {
      const cache =
        source.type === "remote_url"
          ? this.repository.findLatestCache(source.id)
          : undefined;
      const hasContent = Boolean(
        source.type === "remote_url" ? cache?.content : source.rawContent,
      );
      const usingCache =
        source.enabled &&
        source.type === "remote_url" &&
        source.lastFetchStatus === "failed" &&
        hasContent;
      let status: Check["status"] = "ok";
      let message =
        source.type === "remote_url"
          ? "已有可生成订阅的缓存。"
          : "已保存本地内容。";
      if (!source.enabled) {
        status = "warning";
        message = "来源已停用，不参与生成。";
      } else if (!hasContent) {
        status = "error";
        message = "没有可用内容，请先刷新此来源。";
      } else if (usingCache) {
        status = "warning";
        message = "最近刷新失败，当前使用上次成功的缓存。";
      } else if (source.expireAt && source.expireAt.getTime() <= Date.now()) {
        status = "warning";
        message = "上游订阅已到期，缓存仍可生成但节点可能失效。";
      } else if (
        source.trafficTotal != null &&
        source.trafficTotal > 0 &&
        (source.trafficUpload ?? 0) + (source.trafficDownload ?? 0) >=
          source.trafficTotal
      ) {
        status = "warning";
        message = "上游报告流量已用完。";
      }
      return {
        id: source.id,
        name: source.name,
        status,
        message,
        usingCache,
        lastFetchedAt: source.lastFetchedAt?.toISOString() ?? null,
        cachedAt: cache?.fetchedAt.toISOString() ?? null,
      };
    });
    let nodeCount = 0,
      filteredCount = 0,
      generationOk = false;
    try {
      const preview = new OutputService(this.repository).preview(profileId)!;
      generationOk = true;
      nodeCount =
        "finalCount" in preview.summary
          ? preview.summary.finalCount
          : preview.summary.supportedCount;
      filteredCount = preview.summary.filteredCount;
      checks.push({
        key: "generation",
        title: "配置生成",
        status: "ok",
        message: `可以生成 ${preview.format.toUpperCase()} 订阅。`,
      });
      checks.push({
        key: "nodes",
        title: "输出节点",
        status: nodeCount ? "ok" : "error",
        message: nodeCount
          ? `${nodeCount} 个输出节点，筛选排除 ${filteredCount} 个。`
          : "输出没有节点，请检查来源选择、节点筛选和格式兼容性。",
      });
      if (
        preview.warnings.length ||
        ("skippedCount" in preview.summary && preview.summary.skippedCount > 0)
      )
        checks.push({
          key: "compatibility",
          title: "格式兼容性",
          status: "warning",
          message: "转换过程中有跳过或调整，请查看配置预览中的提示。",
        });
    } catch (error) {
      checks.push({
        key: "generation",
        title: "配置生成",
        status: "error",
        message:
          error instanceof OutputNotReadyError
            ? error.message
            : "订阅内容无法解析或配置不完整，请检查来源和规则设置。",
      });
    }
    const state = !profile.enabled
      ? "disabled"
      : !generationOk
        ? "error"
        : !nodeCount
          ? "empty"
          : sources.some((source) => source.status !== "ok") ||
              checks.some((check) => check.status === "warning")
            ? "warning"
            : "ready";
    return {
      state,
      checkedAt: new Date().toISOString(),
      nodeCount,
      filteredCount,
      checks,
      sources,
    };
  }
}
