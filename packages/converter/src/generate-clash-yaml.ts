import { filterProxies } from "./filter-proxies";
import { stringify } from "yaml";

import type {
  OutputProfileOptions,
  ProxyGroup,
  UserRule,
} from "@subscription-converter/shared";

import { dedupeProxies, type DedupeSummary } from "./dedupe-proxies";
import { parseSubscriptionContent } from "./parse-subscription-content";

export type ClashInputSource = {
  sourceName: string;
  content: string;
};

export type GeneratedClashConfig = {
  yaml: string;
  config: Record<string, unknown>;
  summary: DedupeSummary & {
    filteredCount: number;
    groupCount: number;
    ruleCount: number;
    sourceCount: number;
  };
  warnings: string[];
};

function formatRule(
  rule: Pick<UserRule, "ruleType" | "value" | "policy" | "noResolve">,
) {
  return rule.ruleType === "MATCH"
    ? `MATCH,${rule.policy}`
    : `${rule.ruleType},${rule.value},${rule.policy}${rule.noResolve ? ",no-resolve" : ""}`;
}

function mergeGroups(
  configured: ProxyGroup[],
  proxyNames: string[],
  removedNames: Set<string>,
) {
  const groups = new Map<string, Record<string, unknown>>();

  for (const group of configured) {
    const { filter, proxies: configuredProxies, ...outputGroup } = group;
    const matcher = filter ? new RegExp(filter, "i") : undefined;
    const filteredProxies = matcher
      ? proxyNames.filter((name) => matcher.test(name))
      : proxyNames;
    const proxies = [
      ...new Set([
        ...configuredProxies.filter((name) => !removedNames.has(name)),
        ...filteredProxies,
      ]),
    ];
    groups.set(group.name, {
      ...outputGroup,
      proxies: proxies.length > 0 ? proxies : ["DIRECT"],
      ...(group.type !== "select"
        ? {
            url: group.url ?? "https://www.gstatic.com/generate_204",
            interval: group.interval ?? 300,
          }
        : {}),
      ...(group.type === "url-test"
        ? { tolerance: group.tolerance ?? 50 }
        : {}),
    });
  }

  if (!groups.has("PROXY")) {
    groups.set("PROXY", {
      name: "PROXY",
      type: "select",
      proxies: [...proxyNames, "AUTO", "DIRECT"],
    });
  }
  if (!groups.has("AUTO")) {
    groups.set("AUTO", {
      name: "AUTO",
      type: "url-test",
      proxies: proxyNames.length > 0 ? proxyNames : ["DIRECT"],
      url: "https://www.gstatic.com/generate_204",
      interval: 300,
      tolerance: 50,
    });
  }

  return [...groups.values()];
}

export function generateClashYaml(input: {
  sources: ClashInputSource[];
  rules: UserRule[];
  options: OutputProfileOptions;
}): GeneratedClashConfig {
  const parsedSources = input.sources.map((source) => ({
    source,
    parsed: parseSubscriptionContent(source.content),
  }));
  const filtered = filterProxies(
    parsedSources.flatMap(({ source, parsed }) =>
      parsed.proxies.map((proxy) => ({
        ...proxy,
        sourceName: source.sourceName,
      })),
    ),
    input.options.nodeFilter,
  );
  const deduped = dedupeProxies(filtered.proxies);
  const proxyNames = deduped.proxies.map((proxy) => proxy.name);
  const retainedNames = new Set(filtered.proxies.map((proxy) => proxy.name));
  const removedNames = new Set(
    parsedSources
      .flatMap(({ parsed }) => parsed.proxies.map((proxy) => proxy.name))
      .filter((name) => !retainedNames.has(name)),
  );
  const proxyGroups = mergeGroups(
    input.options.proxyGroups,
    proxyNames,
    removedNames,
  );
  const availablePolicies = new Set([
    ...proxyNames,
    ...proxyGroups.map((group) => String(group.name)),
    "DIRECT",
    "REJECT",
    "REJECT-DROP",
    "PASS",
    "COMPATIBLE",
  ]);
  const outputWarnings: string[] = [];
  // Hosts are connection dependencies, independent of upstream routing rules.
  const hosts: Record<string, string | string[]> = Object.create(null);
  for (const { parsed, source } of parsedSources) {
    for (const [domain, addresses] of Object.entries(parsed.hosts)) {
      if (
        Object.hasOwn(hosts, domain) &&
        JSON.stringify(hosts[domain]) !== JSON.stringify(addresses)
      ) {
        outputWarnings.push(
          `${source.sourceName}: conflicting hosts mapping; kept the first source's mapping`,
        );
        continue;
      }
      hosts[domain] = addresses;
    }
  }
  const enabledUserRules = input.rules
    .filter((rule) => rule.enabled)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const userNonMatch = enabledUserRules.filter(
    (rule) => rule.ruleType !== "MATCH",
  );
  const upstreamRules = parsedSources
    .flatMap(({ parsed, source }) =>
      parsed.rules.map((rule) => {
        const parts = rule.split(",").map((part) => part.trim());
        const policyIndex =
          parts.length - (parts.at(-1)?.toLowerCase() === "no-resolve" ? 2 : 1);
        const policy = parts[policyIndex];
        if (
          input.options.preserveUpstreamRules &&
          !availablePolicies.has(policy) &&
          parsed.proxyGroups.some((group) => group.name === policy)
        ) {
          parts[policyIndex] = "PROXY";
          outputWarnings.push(
            `${source.sourceName}: redirected a removed upstream group policy to PROXY`,
          );
        }
        return parts.join(",");
      }),
    )
    .filter((rule) => !/^MATCH(?:,|$)/i.test(rule));
  const matchPolicy =
    enabledUserRules.find((rule) => rule.ruleType === "MATCH")?.policy ??
    input.options.matchPolicy;
  const rules = [
    ...userNonMatch.map(formatRule),
    ...(input.options.preserveUpstreamRules ? upstreamRules : []),
    `MATCH,${matchPolicy}`,
  ];
  const upstreamProviders = Object.assign(
    {},
    ...parsedSources.map(({ parsed }) => parsed.ruleProviders),
  ) as Record<string, Record<string, unknown>>;
  const ruleProviders = {
    ...upstreamProviders,
    ...input.options.ruleProviders,
  };
  const upstreamDns =
    parsedSources.find(({ parsed }) => parsed.dns)?.parsed.dns ?? null;
  const dns = input.options.dns ?? upstreamDns;
  const config: Record<string, unknown> = {
    proxies: deduped.proxies.map((proxy) => {
      const outputProxy = { ...proxy };
      delete outputProxy.sourceName;
      return outputProxy;
    }),
    "proxy-groups": proxyGroups,
    rules,
  };

  if (Object.keys(ruleProviders).length > 0) {
    config["rule-providers"] = ruleProviders;
  }
  if (dns) {
    config.dns = dns;
  }
  if (Object.keys(hosts).length > 0) {
    config.hosts = hosts;
  }

  return {
    yaml: stringify(config, { lineWidth: 0 }),
    config,
    summary: {
      ...deduped.summary,
      inputCount: filtered.inputCount,
      filteredCount: filtered.filteredCount,
      groupCount: proxyGroups.length,
      ruleCount: rules.length,
      sourceCount: input.sources.length,
    },
    warnings: [
      ...outputWarnings,
      ...parsedSources.flatMap(({ source, parsed }) =>
        parsed.warnings.map((warning) => `${source.sourceName}: ${warning}`),
      ),
    ],
  };
}
