import type { ClashProxy } from "./parse-clash-yaml";

export type DedupeSummary = {
  inputCount: number;
  duplicateCount: number;
  renamedCount: number;
  finalCount: number;
};

export type DedupeResult = {
  proxies: ClashProxy[];
  summary: DedupeSummary;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function proxyIdentity(proxy: ClashProxy) {
  const connection = { ...proxy };
  delete connection.sourceName;
  // Display names do not distinguish connections; credentials and options do.
  return JSON.stringify(canonicalize({ ...connection, name: undefined }));
}

function createUniqueName(
  proxy: ClashProxy,
  usedNames: Set<string>,
  occurrence: number,
) {
  const suffix = proxy.sourceName?.trim() || String(occurrence);
  const baseName = `${proxy.name} [${suffix}]`;
  let candidate = baseName;
  let counter = 2;

  while (usedNames.has(candidate)) {
    candidate = `${baseName} ${counter}`;
    counter += 1;
  }

  return candidate;
}

export function dedupeProxies(proxies: ClashProxy[]): DedupeResult {
  const seenIdentities = new Set<string>();
  const usedNames = new Set<string>();
  const nameOccurrences = new Map<string, number>();
  const result: ClashProxy[] = [];
  let duplicateCount = 0;
  let renamedCount = 0;

  for (const proxy of proxies) {
    const identity = proxyIdentity(proxy);
    if (seenIdentities.has(identity)) {
      duplicateCount += 1;
      continue;
    }
    seenIdentities.add(identity);

    const occurrence = (nameOccurrences.get(proxy.name) ?? 0) + 1;
    nameOccurrences.set(proxy.name, occurrence);
    let name = proxy.name;

    if (usedNames.has(name)) {
      name = createUniqueName(proxy, usedNames, occurrence);
      renamedCount += 1;
    }

    usedNames.add(name);
    result.push({ ...proxy, name });
  }

  return {
    proxies: result,
    summary: {
      inputCount: proxies.length,
      duplicateCount,
      renamedCount,
      finalCount: result.length,
    },
  };
}
