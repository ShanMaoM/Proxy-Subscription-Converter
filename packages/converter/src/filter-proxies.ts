import type { NodeFilter } from "@subscription-converter/shared";
import type { ClashProxy } from "./parse-clash-yaml";

/** Filter original names before deduplication so an excluded alias cannot hide an allowed node. */
export function filterProxies(proxies: ClashProxy[], filter?: NodeFilter) {
  const includes =
    filter?.includeKeywords.map((value) => value.toLocaleLowerCase()) ?? [];
  const excludes =
    filter?.excludeKeywords.map((value) => value.toLocaleLowerCase()) ?? [];
  const protocols =
    filter?.protocols == null
      ? null
      : new Set(filter.protocols.map((value) => value.toLowerCase()));
  const selected = proxies.filter((proxy) => {
    const name = proxy.name.toLocaleLowerCase();
    return (
      (!protocols || protocols.has(proxy.type.toLowerCase())) &&
      (!includes.length ||
        includes.some((keyword) => name.includes(keyword))) &&
      !excludes.some((keyword) => name.includes(keyword))
    );
  });
  return {
    proxies: selected,
    inputCount: proxies.length,
    filteredCount: proxies.length - selected.length,
  };
}
