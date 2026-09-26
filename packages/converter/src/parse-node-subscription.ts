import type { ClashConfig, ClashProxy } from "./parse-clash-yaml";
import { parseSsPlugin } from "./ss-plugin";

const knownUriSchemes = ["ss", "vmess", "trojan", "vless", "hysteria2"];
const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64(value: string) {
  const normalized = value
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  if (!normalized || /[^A-Za-z0-9+/=]/.test(normalized)) return undefined;

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of normalized.replace(/=+$/, "")) {
    const index = base64Alphabet.indexOf(character);
    if (index < 0) return undefined;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  try {
    return decodeURIComponent(
      bytes.map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""),
    );
  } catch {
    return undefined;
  }
}

function decodeMaybeBase64(value: string) {
  return decodeBase64(value) ?? value;
}

function splitName(value: string, fallback: string) {
  const [withoutHash, rawName] = value.split("#", 2);
  return {
    body: withoutHash,
    name: rawName ? decodeURIComponent(rawName) : fallback,
  };
}

function parsePort(value: string | null) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

function firstQueryValue(query: URLSearchParams, ...keys: string[]) {
  for (const key of keys) {
    const value = query.get(key);
    if (value) return value;
  }
  return undefined;
}

function isTruthyQuery(value: string | null) {
  return value === "1" || value?.toLowerCase() === "true";
}

function proxyFromUrl(
  type: string,
  uri: string,
  warnings: string[],
): ClashProxy | undefined {
  const { body, name } = splitName(uri, `${type.toUpperCase()} Node`);
  let url: URL;
  try {
    url = new URL(body);
  } catch {
    warnings.push(`Skipped ${type} node: URI is invalid`);
    return undefined;
  }

  const port = parsePort(url.port);
  if (!url.hostname || !port) {
    warnings.push(`Skipped ${type} node ${name}: server and port are required`);
    return undefined;
  }

  const query = url.searchParams;
  const security = query.get("security")?.toLowerCase();
  const tls = ["tls", "reality"].includes(security ?? "");
  const network = query.get("type") ?? query.get("network") ?? undefined;
  const servername = firstQueryValue(query, "sni", "peer");
  const skipCertVerify =
    isTruthyQuery(query.get("allowInsecure")) ||
    isTruthyQuery(query.get("insecure"));
  const proxy: ClashProxy = {
    name,
    type,
    server: url.hostname.replace(/^\[|\]$/g, ""),
    port,
  };

  if (type === "trojan") {
    proxy.password = decodeURIComponent(url.username);
    if (!proxy.password) {
      warnings.push(`Skipped trojan node ${name}: password is required`);
      return undefined;
    }
  }
  if (type === "vless") {
    proxy.uuid = decodeURIComponent(url.username);
    if (!proxy.uuid) {
      warnings.push(`Skipped vless node ${name}: uuid is required`);
      return undefined;
    }
    const flow = query.get("flow");
    if (flow) proxy.flow = flow;
    if (security === "reality") {
      const publicKey = firstQueryValue(query, "pbk", "publicKey");
      const shortId = firstQueryValue(query, "sid", "shortId");
      if (publicKey || shortId) {
        proxy["reality-opts"] = {
          ...(publicKey ? { "public-key": publicKey } : {}),
          ...(shortId ? { "short-id": shortId } : {}),
        };
      }
    }
  }
  if (type === "hysteria2") {
    proxy.password = decodeURIComponent(url.username);
    if (!proxy.password) {
      warnings.push(`Skipped hysteria2 node ${name}: password is required`);
      return undefined;
    }
    const hopPorts = firstQueryValue(query, "ports", "mport");
    if (hopPorts) {
      proxy.ports = hopPorts;
      proxy.mport = hopPorts;
    }
  }

  if (network) proxy.network = network;
  if (tls) proxy.tls = true;
  if (servername) {
    proxy.sni = servername;
    proxy.servername = servername;
  }
  const fingerprint = firstQueryValue(query, "fp", "browser");
  if (fingerprint) proxy["client-fingerprint"] = fingerprint;
  if (skipCertVerify) proxy["skip-cert-verify"] = true;
  const path = query.get("path");
  if (path && network === "ws") {
    proxy["ws-opts"] = {
      path,
      headers: query.get("host") ? { Host: query.get("host") } : undefined,
    };
  }
  const serviceName = query.get("serviceName");
  if (serviceName && network === "grpc") {
    proxy["grpc-opts"] = { "grpc-service-name": serviceName };
  }

  return proxy;
}

function parseSs(uri: string, warnings: string[]) {
  const { body, name } = splitName(uri, "SS Node");
  let payload = body.slice("ss://".length);
  if (!payload.includes("@")) payload = decodeMaybeBase64(payload);
  const atIndex = payload.lastIndexOf("@");
  if (atIndex < 0) {
    warnings.push(`Skipped ss node ${name}: user info is required`);
    return undefined;
  }

  const encodedUserInfo = payload.slice(0, atIndex);
  const userInfo = encodedUserInfo.includes(":")
    ? decodeURIComponent(encodedUserInfo)
    : decodeMaybeBase64(decodeURIComponent(encodedUserInfo));
  const serverPart = payload.slice(atIndex + 1);
  const separator = userInfo.indexOf(":");
  if (separator < 0) {
    warnings.push(`Skipped ss node ${name}: cipher and password are required`);
    return undefined;
  }

  const hostUrl = new URL(`ss://${serverPart}`);
  const port = parsePort(hostUrl.port);
  if (!hostUrl.hostname || !port) {
    warnings.push(`Skipped ss node ${name}: server and port are required`);
    return undefined;
  }

  const pluginText = hostUrl.searchParams.get("plugin");
  const plugin = pluginText ? parseSsPlugin(pluginText) : {};
  if (!plugin) {
    warnings.push(
      "Skipped ss node: unsupported plugin options; use the original Clash YAML",
    );
    return undefined;
  }

  return {
    name,
    type: "ss",
    server: hostUrl.hostname.replace(/^\[|\]$/g, ""),
    port,
    cipher: userInfo.slice(0, separator),
    password: userInfo.slice(separator + 1),
    ...plugin,
  } satisfies ClashProxy;
}

function parseVmess(uri: string, warnings: string[]) {
  const decoded = decodeBase64(uri.slice("vmess://".length));
  if (!decoded) {
    warnings.push("Skipped vmess node: payload is not valid base64");
    return undefined;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    warnings.push("Skipped vmess node: payload is not valid JSON");
    return undefined;
  }

  const name = String(payload.ps || payload.name || "VMess Node");
  const server = String(payload.add || payload.server || "");
  const port = parsePort(String(payload.port ?? ""));
  const uuid = String(payload.id || payload.uuid || "");
  if (!server || !port || !uuid) {
    warnings.push(
      `Skipped vmess node ${name}: server, port and uuid are required`,
    );
    return undefined;
  }

  const network = String(payload.net || payload.network || "tcp");
  const proxy: ClashProxy = {
    name,
    type: "vmess",
    server,
    port,
    uuid,
    alterId: Number(payload.aid ?? payload.alterId ?? 0),
    cipher: "auto",
    network,
  };
  if (payload.tls) proxy.tls = String(payload.tls) === "tls";
  if (payload.sni || payload.host)
    proxy.servername = String(payload.sni || payload.host);
  if (network === "ws" && payload.path) {
    proxy["ws-opts"] = {
      path: String(payload.path),
      headers: payload.host ? { Host: String(payload.host) } : undefined,
    };
  }
  return proxy;
}

export function parseNodeSubscription(content: string): ClashConfig {
  const decoded = decodeBase64(content.trim());
  const text = decoded && hasNodeUriLines(decoded) ? decoded : content;
  const warnings: string[] = [];
  const proxies = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const scheme = line.match(/^([a-z0-9+.-]+):\/\//i)?.[1]?.toLowerCase();
      if (!scheme) return undefined;
      try {
        if (scheme === "ss") return parseSs(line, warnings);
        if (scheme === "vmess") return parseVmess(line, warnings);
        if (["trojan", "vless", "hysteria2"].includes(scheme)) {
          return proxyFromUrl(scheme, line, warnings);
        }
      } catch {
        warnings.push(`Skipped ${scheme} node: URI is invalid`);
        return undefined;
      }
      warnings.push(`Skipped unsupported URI scheme: ${scheme}`);
      return undefined;
    })
    .filter((proxy): proxy is ClashProxy => proxy !== undefined);
  const names = new Map<string, number>();
  for (const proxy of proxies) {
    names.set(proxy.name, (names.get(proxy.name) ?? 0) + 1);
  }

  return {
    proxies,
    proxyGroups: [],
    rules: [],
    ruleProviders: {},
    dns: null,
    hosts: {},
    duplicateProxyNames: [...names.entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
    warnings,
  };
}

export function looksLikeNodeSubscription(content: string) {
  const trimmed = content.trim();
  if (hasNodeUriLines(trimmed)) {
    return true;
  }
  const decoded = decodeBase64(trimmed);
  return decoded ? hasNodeUriLines(decoded) : false;
}

function hasNodeUriLines(content: string) {
  return content.split(/\r?\n/).some((line) => {
    const scheme = line
      .trim()
      .match(/^([a-z0-9+.-]+):\/\//i)?.[1]
      ?.toLowerCase();
    return scheme !== undefined && knownUriSchemes.includes(scheme);
  });
}
