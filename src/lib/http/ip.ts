import { BlockList, isIP } from "node:net";

/**
 * Addresses that must never be reachable from server-side fetches (SSRF):
 * loopback, private, link-local (incl. cloud metadata 169.254.169.254),
 * CGNAT, documentation, benchmarking, multicast and reserved ranges.
 */
const blocked = new BlockList();

const V4: Array<[string, number]> = [
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
];

const V6: Array<[string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001::", 32], // Teredo
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

for (const [net, prefix] of V4) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of V6) blocked.addSubnet(net, prefix, "ipv6");

/** Extract an embedded IPv4 address from mapped / NAT64 / 6to4 IPv6 forms. */
function embeddedIpv4(address: string): string | undefined {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];

  const hexMapped = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1]!, 16);
    const lo = parseInt(hexMapped[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }

  const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
  if (sixToFour) {
    const hi = parseInt(sixToFour[1]!, 16);
    const lo = parseInt(sixToFour[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return undefined;
}

export function isBlockedAddress(address: string): boolean {
  const cleaned = address.replace(/^\[|\]$/g, "").split("%")[0]!;
  const family = isIP(cleaned);
  if (family === 4) return blocked.check(cleaned, "ipv4");
  if (family === 6) {
    const v4 = embeddedIpv4(cleaned);
    if (v4 && blocked.check(v4, "ipv4")) return true;
    return blocked.check(cleaned, "ipv6");
  }
  // Not an IP literal — treat as unsafe; callers must resolve first.
  return true;
}
