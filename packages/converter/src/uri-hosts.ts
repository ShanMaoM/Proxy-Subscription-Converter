import type { ClashConfig, ClashProxy } from "./parse-clash-yaml";

// URI lists have no hosts section. Resolve explicit upstream aliases locally,
// without querying DNS, and retain the original TLS identity when replacing it.
export function applyUriHosts(
  proxy: ClashProxy,
  hosts: ClashConfig["hosts"],
  warnings: string[],
): ClashProxy {
  const entries = new Map(
    Object.entries(hosts).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const seen = new Set<string>();
  let server = proxy.server;
  while (entries.has(server.toLowerCase())) {
    const key = server.toLowerCase();
    if (seen.has(key)) {
      warnings.push(
        "hosts 存在循环映射，节点 URI 无法表达，请使用 YAML 输出。",
      );
      return proxy;
    }
    seen.add(key);
    const mapped = entries.get(key)!;
    if (Array.isArray(mapped) && mapped.length > 1) {
      warnings.push(
        "节点 URI 仅使用 hosts 地址列表中的第一个地址；如需多地址回退，请使用 YAML 输出。",
      );
    }
    const address = Array.isArray(mapped) ? mapped[0] : mapped;
    if (!address) break;
    server = address;
  }
  if (server === proxy.server) return proxy;
  const result: ClashProxy = { ...proxy, server };
  if (
    (proxy.tls || proxy.type === "trojan" || proxy.type === "hysteria2") &&
    !proxy.sni &&
    !proxy.servername &&
    !proxy["server-name"]
  ) {
    result.sni = proxy.server;
    result.servername = proxy.server;
  }
  return result;
}
