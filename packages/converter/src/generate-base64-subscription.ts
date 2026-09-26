import { filterProxies } from "./filter-proxies";
import type { NodeFilter } from "@subscription-converter/shared";
import { dedupeProxies } from "./dedupe-proxies";
import type { ClashInputSource } from "./generate-clash-yaml";
import type { ClashProxy } from "./parse-clash-yaml";
import { parseSubscriptionContent } from "./parse-subscription-content";
import { generateSsPlugin } from "./ss-plugin";
import { applyUriHosts } from "./uri-hosts";

const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8Bytes(value: string) {
  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }
  return bytes;
}

function encodeBase64(value: string) {
  const bytes = utf8Bytes(value);
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const block = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    result += base64Alphabet[(block >> 18) & 63];
    result += base64Alphabet[(block >> 12) & 63];
    result += second === undefined ? "=" : base64Alphabet[(block >> 6) & 63];
    result += third === undefined ? "=" : base64Alphabet[block & 63];
  }
  return result;
}

function hostPort(proxy: ClashProxy) {
  const host = proxy.server.includes(":") ? `[${proxy.server}]` : proxy.server;
  return `${host}:${proxy.port}`;
}

function stringField(proxy: ClashProxy, key: string) {
  const value = proxy[key];
  return typeof value === "string" && value ? value : undefined;
}

function recordField(proxy: ClashProxy, key: string) {
  const value = proxy[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function appendCommonTlsParams(proxy: ClashProxy, query: URLSearchParams) {
  const servername =
    stringField(proxy, "sni") ??
    stringField(proxy, "servername") ??
    stringField(proxy, "server-name");
  const fingerprint = stringField(proxy, "client-fingerprint");
  if (servername) query.set("sni", servername);
  if (fingerprint) query.set("fp", fingerprint);
  if (proxy["skip-cert-verify"] === true) query.set("allowInsecure", "1");
}

function appendTransportParams(proxy: ClashProxy, query: URLSearchParams) {
  const network = stringField(proxy, "network");
  if (network) query.set("type", network);
  const wsOpts = recordField(proxy, "ws-opts");
  if (network === "ws" && wsOpts) {
    if (typeof wsOpts.path === "string") query.set("path", wsOpts.path);
    const headers = wsOpts.headers;
    if (headers && typeof headers === "object" && "Host" in headers) {
      const host = (headers as { Host?: unknown }).Host;
      if (typeof host === "string" && host) query.set("host", host);
    }
  }
  const grpcOpts = recordField(proxy, "grpc-opts");
  const serviceName = grpcOpts?.["grpc-service-name"];
  if (network === "grpc" && typeof serviceName === "string" && serviceName) {
    query.set("serviceName", serviceName);
  }
}

export function generateSsUri(proxy: ClashProxy) {
  const cipher = stringField(proxy, "cipher");
  const password = stringField(proxy, "password");
  if (!cipher || !password) return undefined;
  const plugin = proxy.plugin ? generateSsPlugin(proxy) : undefined;
  if (proxy.plugin && !plugin) return undefined;
  const userInfo = cipher.startsWith("2022-")
    ? `${encodeURIComponent(cipher)}:${encodeURIComponent(password)}`
    : encodeBase64(`${cipher}:${password}`)
        .replace(/=+$/, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
  return `ss://${userInfo}@${hostPort(
    proxy,
  )}${plugin ? `/?plugin=${encodeURIComponent(plugin)}` : ""}#${encodeURIComponent(proxy.name)}`;
}

export function generateTrojanUri(proxy: ClashProxy) {
  const password = stringField(proxy, "password");
  if (!password) return undefined;
  const query = new URLSearchParams();
  appendCommonTlsParams(proxy, query);
  appendTransportParams(proxy, query);
  const queryText = query.toString();
  return `trojan://${encodeURIComponent(password)}@${hostPort(proxy)}${
    queryText ? `?${queryText}` : ""
  }#${encodeURIComponent(proxy.name)}`;
}

export function generateVlessUri(proxy: ClashProxy) {
  const uuid = stringField(proxy, "uuid");
  if (!uuid) return undefined;
  const query = new URLSearchParams();
  const realityOpts = recordField(proxy, "reality-opts");
  query.set("security", realityOpts ? "reality" : proxy.tls ? "tls" : "none");
  appendCommonTlsParams(proxy, query);
  appendTransportParams(proxy, query);
  const flow = stringField(proxy, "flow");
  if (flow) query.set("flow", flow);
  const publicKey = realityOpts?.["public-key"];
  const shortId = realityOpts?.["short-id"];
  if (typeof publicKey === "string" && publicKey) query.set("pbk", publicKey);
  if (typeof shortId === "string" && shortId) query.set("sid", shortId);
  return `vless://${encodeURIComponent(uuid)}@${hostPort(proxy)}?${query.toString()}#${encodeURIComponent(
    proxy.name,
  )}`;
}

export function generateHysteria2Uri(proxy: ClashProxy) {
  const password = stringField(proxy, "password");
  if (!password) return undefined;
  const query = new URLSearchParams();
  appendCommonTlsParams(proxy, query);
  const hopPorts = stringField(proxy, "ports") ?? stringField(proxy, "mport");
  if (hopPorts) {
    query.set("ports", hopPorts);
    query.set("mport", hopPorts);
  }
  const queryText = query.toString();
  return `hysteria2://${encodeURIComponent(password)}@${hostPort(proxy)}${
    queryText ? `?${queryText}` : ""
  }#${encodeURIComponent(proxy.name)}`;
}

export function generateVmessUri(proxy: ClashProxy) {
  const uuid = stringField(proxy, "uuid");
  if (!uuid) return undefined;
  const wsOpts = recordField(proxy, "ws-opts");
  const headers = wsOpts?.headers;
  const wsHost =
    headers && typeof headers === "object" && "Host" in headers
      ? (headers as { Host?: unknown }).Host
      : undefined;
  const payload = {
    v: "2",
    ps: proxy.name,
    add: proxy.server,
    port: String(proxy.port),
    id: uuid,
    aid: String(
      typeof proxy.alterId === "number" || typeof proxy.alterId === "string"
        ? proxy.alterId
        : 0,
    ),
    net: stringField(proxy, "network") ?? "tcp",
    type: "none",
    host:
      typeof wsHost === "string" && wsHost
        ? wsHost
        : (stringField(proxy, "servername") ?? ""),
    path: typeof wsOpts?.path === "string" ? wsOpts.path : "",
    tls: proxy.tls ? "tls" : "",
  };
  return `vmess://${encodeBase64(JSON.stringify(payload)).replace(/=+$/, "")}`;
}

export function generateProxyUri(proxy: ClashProxy) {
  const type = proxy.type.toLowerCase();
  if (type === "ss") return generateSsUri(proxy);
  if (type === "trojan") return generateTrojanUri(proxy);
  if (type === "vmess") return generateVmessUri(proxy);
  if (type === "vless") return generateVlessUri(proxy);
  if (type === "hysteria2") return generateHysteria2Uri(proxy);
  return undefined;
}

export function generateBase64Subscription(input: {
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
    const uri = generateProxyUri(proxy);
    if (!uri) {
      if (proxy.type.toLowerCase() === "ss" && proxy.plugin) {
        outputWarnings.push(
          "SS 插件参数无法完整转换为节点 URI，已跳过；请使用 YAML 输出。",
        );
      }
      skippedCount += 1;
      unsupportedTypes.add(proxy.type.toLowerCase());
      continue;
    }
    lines.push(uri);
  }

  return {
    content: encodeBase64(lines.join("\n")),
    plainText: lines.join("\n"),
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
