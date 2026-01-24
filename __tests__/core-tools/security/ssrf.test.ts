import { describe, it, expect, vi } from "vitest";
import { isIpInBlockedCidrs } from "../../../src/core-tools/security/ssrf.js";

// Mock dns/promises
vi.mock("node:dns/promises", () => {
  return {
    lookup: vi.fn().mockResolvedValue({ address: "203.0.113.50", family: 4 }),
  };
});

describe("isIpInBlockedCidrs", () => {
  const defaultCidrs = [
    "127.0.0.0/8",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
  ];

  it("blocks 127.0.0.1 (loopback)", () => {
    expect(isIpInBlockedCidrs("127.0.0.1", defaultCidrs)).toBe(true);
  });

  it("blocks 127.0.0.255 (loopback range)", () => {
    expect(isIpInBlockedCidrs("127.0.0.255", defaultCidrs)).toBe(true);
  });

  it("blocks 10.0.0.1 (private class A)", () => {
    expect(isIpInBlockedCidrs("10.0.0.1", defaultCidrs)).toBe(true);
  });

  it("blocks 10.255.255.255 (private class A max)", () => {
    expect(isIpInBlockedCidrs("10.255.255.255", defaultCidrs)).toBe(true);
  });

  it("blocks 172.16.0.1 (private class B start)", () => {
    expect(isIpInBlockedCidrs("172.16.0.1", defaultCidrs)).toBe(true);
  });

  it("blocks 172.31.255.255 (private class B end)", () => {
    expect(isIpInBlockedCidrs("172.31.255.255", defaultCidrs)).toBe(true);
  });

  it("does not block 172.32.0.1 (outside class B range)", () => {
    expect(isIpInBlockedCidrs("172.32.0.1", defaultCidrs)).toBe(false);
  });

  it("blocks 192.168.1.1 (private class C)", () => {
    expect(isIpInBlockedCidrs("192.168.1.1", defaultCidrs)).toBe(true);
  });

  it("blocks 169.254.169.254 (AWS metadata)", () => {
    expect(isIpInBlockedCidrs("169.254.169.254", defaultCidrs)).toBe(true);
  });

  it("does not block public IP 8.8.8.8", () => {
    expect(isIpInBlockedCidrs("8.8.8.8", defaultCidrs)).toBe(false);
  });

  it("does not block public IP 203.0.113.50", () => {
    expect(isIpInBlockedCidrs("203.0.113.50", defaultCidrs)).toBe(false);
  });

  it("handles empty CIDR list", () => {
    expect(isIpInBlockedCidrs("127.0.0.1", [])).toBe(false);
  });
});

const { validateUrl } = await import("../../../src/core-tools/security/ssrf.js");
const dns = await import("node:dns/promises");
const mockLookup = dns.lookup as ReturnType<typeof vi.fn>;

describe("validateUrl", () => {
  const allowedHosts = ["api.github.com", "*.example.com"];
  const blockedCidrs = [
    "127.0.0.0/8",
    "10.0.0.0/8",
    "169.254.0.0/16",
  ];

  it("allows a valid URL with allowed host", async () => {
    mockLookup.mockResolvedValueOnce({ address: "203.0.113.50", family: 4 });
    const result = await validateUrl(
      "https://api.github.com/repos",
      allowedHosts,
      blockedCidrs,
    );
    expect(result.hostname).toBe("api.github.com");
  });

  it("allows wildcard subdomain match", async () => {
    mockLookup.mockResolvedValueOnce({ address: "203.0.113.50", family: 4 });
    const result = await validateUrl(
      "https://sub.example.com/path",
      allowedHosts,
      blockedCidrs,
    );
    expect(result.hostname).toBe("sub.example.com");
  });

  it("rejects host not in allowlist", async () => {
    await expect(
      validateUrl("https://evil.com/steal", allowedHosts, blockedCidrs),
    ).rejects.toMatchObject({ kind: "HTTP_DISALLOWED_HOST" });
  });

  it("rejects non-http protocols", async () => {
    await expect(
      validateUrl("ftp://api.github.com/file", allowedHosts, blockedCidrs),
    ).rejects.toMatchObject({ kind: "HTTP_DISALLOWED_HOST" });
  });

  it("rejects invalid URL", async () => {
    await expect(
      validateUrl("not-a-url", allowedHosts, blockedCidrs),
    ).rejects.toMatchObject({ kind: "HTTP_DISALLOWED_HOST" });
  });

  it("blocks DNS rebinding to private IP", async () => {
    mockLookup.mockResolvedValueOnce({ address: "127.0.0.1", family: 4 });
    await expect(
      validateUrl("https://api.github.com/repos", allowedHosts, blockedCidrs),
    ).rejects.toMatchObject({ kind: "HTTP_DISALLOWED_HOST" });
  });

  it("blocks DNS resolution to AWS metadata IP", async () => {
    mockLookup.mockResolvedValueOnce({ address: "169.254.169.254", family: 4 });
    await expect(
      validateUrl("https://api.github.com/repos", allowedHosts, blockedCidrs),
    ).rejects.toMatchObject({ kind: "HTTP_DISALLOWED_HOST" });
  });

  it("blocks DNS resolution failure", async () => {
    mockLookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(
      validateUrl("https://api.github.com/repos", allowedHosts, blockedCidrs),
    ).rejects.toMatchObject({ kind: "HTTP_DISALLOWED_HOST" });
  });
});
