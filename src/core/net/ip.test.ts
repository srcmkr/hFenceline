import { describe, expect, it } from "vitest";
import { cidrContains, hasHostBits, isValidIPv4, normalizeCidr, parseCidr4 } from "./ip";

describe("ip", () => {
  it("prüft IPv4 streng", () => {
    expect(isValidIPv4("192.0.2.1")).toBe(true);
    expect(isValidIPv4("192.0.2")).toBe(false);
    expect(isValidIPv4("192.0.2.256")).toBe(false);
    expect(isValidIPv4("192.0.02.1")).toBe(false);
  });
  it("normalisiert CIDR", () => {
    expect(normalizeCidr("192.0.2.1")).toBe("192.0.2.1/32");
    expect(normalizeCidr("192.0.2.77/24")).toBe("192.0.2.0/24");
    expect(normalizeCidr(" 2001:DB8::/32 ")).toBe("2001:db8::/32");
    expect(normalizeCidr("0.0.0.0/0")).toBe("0.0.0.0/0");
  });
  it("präfix/hostbits", () => {
    expect(parseCidr4("1.2.3.4/33")).toBeUndefined();
    expect(parseCidr4("1.2.3.4/x")).toBeUndefined();
    expect(hasHostBits("10.0.0.5/24")).toBe(true);
    expect(hasHostBits("10.0.0.0/24")).toBe(false);
  });
  it("prüft Enthaltensein", () => {
    expect(cidrContains("203.0.113.0/24", "203.0.113.7")).toBe(true);
    expect(cidrContains("203.0.113.0/24", "203.0.114.7")).toBe(false);
    expect(cidrContains("0.0.0.0/0", "8.8.8.8")).toBe(true);
    expect(cidrContains("203.0.113.7/32", "203.0.113.7")).toBe(true);
  });
});
