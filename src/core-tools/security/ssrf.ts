import { lookup } from "node:dns/promises";
import { createTaggedError } from "../../core/Retry.js";

/**
 * Validate a URL against allowed hosts and blocked CIDRs.
 * Prevents SSRF by checking both hostname allowlist and resolved IP addresses.
 *
 * @throws HTTP_DISALLOWED_HOST if the URL is blocked
 */
export async function validateUrl(
  url: string,
  allowedHosts: string[],
  blockedCidrs: string[],
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw createTaggedError(
      "HTTP_DISALLOWED_HOST",
      `Invalid URL: ${url}`,
      { url },
    );
  }

  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createTaggedError(
      "HTTP_DISALLOWED_HOST",
      `Protocol not allowed: ${parsed.protocol}. Only http: and https: are supported.`,
      { url, protocol: parsed.protocol },
    );
  }

  const hostname = parsed.hostname;

  // Check allowlist
  if (!isHostAllowed(hostname, allowedHosts)) {
    throw createTaggedError(
      "HTTP_DISALLOWED_HOST",
      `Host "${hostname}" is not in the allowed hosts list`,
      { url, hostname, allowedHosts },
    );
  }

  // DNS resolve and check against blocked CIDRs
  try {
    const { address } = await lookup(hostname);
    if (isIpInBlockedCidrs(address, blockedCidrs)) {
      throw createTaggedError(
        "HTTP_DISALLOWED_HOST",
        `Host "${hostname}" resolves to blocked IP: ${address}`,
        { url, hostname, resolvedIp: address },
      );
    }
  } catch (err) {
    // Re-throw our tagged errors
    if (err instanceof Error && (err as any).kind === "HTTP_DISALLOWED_HOST") {
      throw err;
    }
    // DNS resolution failure — block by default
    throw createTaggedError(
      "HTTP_DISALLOWED_HOST",
      `DNS resolution failed for host "${hostname}": ${err instanceof Error ? err.message : String(err)}`,
      { url, hostname },
    );
  }

  return parsed;
}

/**
 * Check if a hostname matches any entry in the allowed hosts list.
 * Supports wildcard prefix matching (e.g. "*.github.com" matches "api.github.com").
 */
function isHostAllowed(hostname: string, allowedHosts: string[]): boolean {
  for (const pattern of allowedHosts) {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // ".github.com"
      if (hostname.endsWith(suffix) || hostname === pattern.slice(2)) {
        return true;
      }
    } else if (hostname === pattern) {
      return true;
    }
  }
  return false;
}

/**
 * Check if an IPv4 address falls within any blocked CIDR range.
 */
export function isIpInBlockedCidrs(ip: string, cidrs: string[]): boolean {
  // Handle IPv4-mapped IPv6
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) return false;

  for (const cidr of cidrs) {
    if (cidr.includes(":")) {
      // IPv6 CIDR — skip for IPv4 addresses
      if (!ip.includes(":")) continue;
      if (isIpv6InCidr(ip, cidr)) return true;
    } else {
      if (isIpv4InCidr(normalizedIp, cidr)) return true;
    }
  }
  return false;
}

function normalizeIp(ip: string): string | null {
  // Handle IPv4-mapped IPv6 (e.g. "::ffff:127.0.0.1")
  if (ip.startsWith("::ffff:")) {
    return ip.slice(7);
  }
  // Pure IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    return ip;
  }
  return null;
}

function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [cidrIp, prefixStr] = cidr.split("/");
  if (!cidrIp || !prefixStr) return false;

  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipNum = ipv4ToNum(ip);
  const cidrNum = ipv4ToNum(cidrIp);
  if (ipNum === null || cidrNum === null) return false;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (cidrNum & mask);
}

function ipv4ToNum(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

function isIpv6InCidr(ip: string, cidr: string): boolean {
  // Simplified IPv6 CIDR matching for common cases (::1, fc00::, fe80::)
  const [cidrIp, prefixStr] = cidr.split("/");
  if (!cidrIp || !prefixStr) return false;

  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix)) return false;

  const ipBytes = expandIpv6(ip);
  const cidrBytes = expandIpv6(cidrIp);
  if (!ipBytes || !cidrBytes) return false;

  // Compare prefix bits
  const fullBytes = Math.floor(prefix / 8);
  for (let i = 0; i < fullBytes && i < 16; i++) {
    if (ipBytes[i] !== cidrBytes[i]) return false;
  }

  const remainingBits = prefix % 8;
  if (remainingBits > 0 && fullBytes < 16) {
    const mask = (~0 << (8 - remainingBits)) & 0xff;
    if ((ipBytes[fullBytes]! & mask) !== (cidrBytes[fullBytes]! & mask)) return false;
  }

  return true;
}

function expandIpv6(ip: string): number[] | null {
  // Remove zone ID
  const zoneIdx = ip.indexOf("%");
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);

  const parts = ip.split("::");
  if (parts.length > 2) return null;

  const bytes: number[] = new Array(16).fill(0);

  const expandGroup = (group: string): number[] => {
    if (!group) return [];
    return group.split(":").flatMap((hex) => {
      const val = parseInt(hex || "0", 16);
      return [(val >> 8) & 0xff, val & 0xff];
    });
  };

  if (parts.length === 1) {
    const expanded = expandGroup(parts[0]!);
    if (expanded.length !== 16) return null;
    return expanded;
  }

  const left = expandGroup(parts[0]!);
  const right = expandGroup(parts[1]!);

  if (left.length + right.length > 16) return null;

  for (let i = 0; i < left.length; i++) bytes[i] = left[i]!;
  for (let i = 0; i < right.length; i++) bytes[16 - right.length + i] = right[i]!;

  return bytes;
}
