import { parse } from "yaml";

export type ClashProxy = {
  name: string;
  type: string;
  server: string;
  port: number;
  sourceName?: string;
  [key: string]: unknown;
};

export type ClashProxyGroup = {
  name: string;
  type: string;
  proxies?: string[];
  [key: string]: unknown;
};

export type ClashConfig = {
  proxies: ClashProxy[];
  proxyGroups: ClashProxyGroup[];
  rules: string[];
  ruleProviders: Record<string, Record<string, unknown>>;
  dns: Record<string, unknown> | null;
  hosts: Record<string, string | string[]>;
  duplicateProxyNames: string[];
  warnings: string[];
};

export class ClashYamlParseError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "ClashYamlParseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProxy(value: unknown, index: number, warnings: string[]) {
  if (!isRecord(value)) {
    warnings.push(`Skipped proxy at index ${index}: expected an object`);
    return undefined;
  }

  const { name, type, server, port } = value;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof type !== "string" ||
    !type.trim() ||
    typeof server !== "string" ||
    !server.trim() ||
    (typeof port !== "number" && typeof port !== "string")
  ) {
    warnings.push(
      `Skipped proxy at index ${index}: name, type, server and port are required`,
    );
    return undefined;
  }

  const normalizedPort = Number(port);
  if (
    !Number.isInteger(normalizedPort) ||
    normalizedPort <= 0 ||
    normalizedPort > 65535
  ) {
    warnings.push(`Skipped proxy ${name}: port must be a positive integer`);
    return undefined;
  }

  return {
    ...value,
    name: name.trim(),
    type: type.trim(),
    server: server.trim(),
    port: normalizedPort,
  } satisfies ClashProxy;
}

function normalizeProxyGroup(
  value: unknown,
  index: number,
  warnings: string[],
): ClashProxyGroup | undefined {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.type !== "string"
  ) {
    warnings.push(
      `Skipped proxy group at index ${index}: name and type are required`,
    );
    return undefined;
  }

  const normalized: ClashProxyGroup = {
    ...value,
    name: value.name.trim(),
    type: value.type.trim(),
  };

  if (Array.isArray(value.proxies)) {
    normalized.proxies = value.proxies.filter(
      (proxyName): proxyName is string => typeof proxyName === "string",
    );
  }

  return normalized;
}

export function parseClashYaml(content: string): ClashConfig {
  let parsed: unknown;
  try {
    parsed = parse(content, { prettyErrors: false });
  } catch {
    throw new ClashYamlParseError("Invalid YAML syntax");
  }

  if (!isRecord(parsed)) {
    throw new ClashYamlParseError(
      "Clash configuration must be a YAML object at the document root",
    );
  }

  const warnings: string[] = [];
  const proxies = (Array.isArray(parsed.proxies) ? parsed.proxies : [])
    .map((proxy, index) => normalizeProxy(proxy, index, warnings))
    .filter((proxy): proxy is ClashProxy => proxy !== undefined);
  const proxyGroups = (
    Array.isArray(parsed["proxy-groups"]) ? parsed["proxy-groups"] : []
  )
    .map((group, index) => normalizeProxyGroup(group, index, warnings))
    .filter((group): group is ClashProxyGroup => group !== undefined);
  const rules = (Array.isArray(parsed.rules) ? parsed.rules : []).filter(
    (rule): rule is string => typeof rule === "string",
  );
  const names = new Map<string, number>();
  for (const proxy of proxies) {
    names.set(proxy.name, (names.get(proxy.name) ?? 0) + 1);
  }

  return {
    proxies,
    proxyGroups,
    rules,
    ruleProviders: isRecord(parsed["rule-providers"])
      ? Object.fromEntries(
          Object.entries(parsed["rule-providers"]).filter(
            (entry): entry is [string, Record<string, unknown>] =>
              isRecord(entry[1]),
          ),
        )
      : {},
    dns: isRecord(parsed.dns) ? parsed.dns : null,
    hosts: isRecord(parsed.hosts)
      ? Object.fromEntries(
          Object.entries(parsed.hosts).filter(
            (entry): entry is [string, string | string[]] =>
              typeof entry[1] === "string" ||
              (Array.isArray(entry[1]) &&
                entry[1].every((address) => typeof address === "string")),
          ),
        )
      : {},
    duplicateProxyNames: [...names.entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
    warnings,
  };
}
