import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";

const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blockedV4.addSubnet(address, prefix);

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blockedV6.addSubnet(address, prefix, "ipv6");

export function isBlockedAddress(address: string) {
  if (isIP(address) === 4) return blockedV4.check(address);
  if (isIP(address) === 6) {
    // Only global unicast is accepted; mapped IPv4 and transition ranges
    // must not bypass the IPv4 restrictions.
    return !globalV6.check(address, "ipv6") || blockedV6.check(address, "ipv6");
  }
  return true;
}

export function createPinnedLookup(
  hostname: string,
  addresses: string[],
): LookupFunction {
  if (!addresses.length || addresses.some(isBlockedAddress)) {
    throw new Error("Cannot connect to a private or local address");
  }
  const approved = addresses.map((address) => ({
    address,
    family: isIP(address),
  }));
  return (requestedHost, options, callback) => {
    if (requestedHost !== hostname) {
      callback(new Error("Unexpected remote hostname"), "", 0);
      return;
    }
    if (options.all) {
      callback(null, approved);
    } else {
      const chosen = approved.find(
        (entry) => !options.family || entry.family === options.family,
      );
      if (!chosen)
        callback(new Error("No approved address for requested family"), "", 0);
      else callback(null, chosen.address, chosen.family);
    }
  };
}
