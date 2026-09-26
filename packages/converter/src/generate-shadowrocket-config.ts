import { filterProxies } from "./filter-proxies";
import type { NodeFilter } from "@subscription-converter/shared";
import { dedupeProxies } from "./dedupe-proxies";
import type { ClashInputSource } from "./generate-clash-yaml";
import { parseSubscriptionContent } from "./parse-subscription-content";
import { applyUriHosts } from "./uri-hosts";
import {
  generateSsUri,
  generateTrojanUri,
  generateVmessUri,
} from "./generate-base64-subscription";
export function generateShadowrocketConfig(input: {
  sources: ClashInputSource[];
  nodeFilter?: NodeFilter;
}) {
  const outputWarnings: string[] = [];
  const parsed = input.sources.map((source) => ({
    source,
    config: parseSubscriptionContent(source.content),
  }));
  const filtered = filterProxies(
    parsed.flatMap(({ source, config }) =>
      config.proxies.map((proxy) => ({
        ...applyUriHosts(proxy, config.hosts, outputWarnings),
        sourceName: source.sourceName,
      })),
    ),
    input.nodeFilter,
  );
  const deduped = dedupeProxies(filtered.proxies);
  const lines: string[] = [];
  const unsupportedTypes = new Set<string>();
  let skippedCount = 0;

  for (const proxy of deduped.proxies) {
    const type = proxy.type.toLowerCase();
    const uri =
      type === "ss"
        ? generateSsUri(proxy)
        : type === "trojan"
          ? generateTrojanUri(proxy)
          : type === "vmess"
            ? generateVmessUri(proxy)
            : undefined;
    if (!uri) {
      if (type === "ss" && proxy.plugin) {
        outputWarnings.push(
          "SS 插件参数无法完整转换为节点 URI，已跳过；请使用 YAML 输出。",
        );
      }
      skippedCount += 1;
      unsupportedTypes.add(type);
      continue;
    }
    lines.push(uri);
  }

  return {
    content: lines.join("\n"),
    summary: {
      inputCount: filtered.inputCount,
      filteredCount: filtered.filteredCount,
      supportedCount: lines.length,
      skippedCount,
      duplicateCount: deduped.summary.duplicateCount,
      unsupportedTypes: [...unsupportedTypes].sort(),
    },
    warnings: [
      ...new Set(outputWarnings),
      ...parsed.flatMap(({ source, config }) =>
        config.warnings.map((warning) => `${source.sourceName}: ${warning}`),
      ),
    ],
  };
}
