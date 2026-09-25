export const ANY_IPV4 = "0.0.0.0/0";
export const ANY_IPV6 = "::/0";

const OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

export function isValidIPv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((p) => OCTET.test(p));
}

function toInt(ip: string): number {
  return ip.split(".").reduce((acc, p) => acc * 256 + Number(p), 0);
}

function fromInt(n: number): string {
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
}

export interface Cidr4 {
  network: number;
  prefix: number;
}

export function parseCidr4(value: string): Cidr4 | undefined {
  const [ip, prefixText, ...rest] = value.trim().split("/");
  if (rest.length > 0 || ip === undefined || !isValidIPv4(ip)) return undefined;
  let prefix = 32;
  if (prefixText !== undefined) {
    if (!/^\d{1,2}$/.test(prefixText)) return undefined;
    prefix = Number(prefixText);
    if (prefix > 32) return undefined;
  }
  const size = 2 ** (32 - prefix);
  return { network: Math.floor(toInt(ip) / size) * size, prefix };
}

export function hasHostBits(value: string): boolean {
  const parsed = parseCidr4(value);
  if (!parsed) return false;
  const ip = value.trim().split("/")[0]!;
  return toInt(ip) !== parsed.network;
}

export function formatCidr4(c: Cidr4): string {
  return `${fromInt(c.network)}/${c.prefix}`;
}

export function normalizeCidr(value: string): string {
  const v4 = parseCidr4(value);
  if (v4) return formatCidr4(v4);
  return value.trim().toLowerCase();
}

export function isValidCidr4(value: string): boolean {
  return parseCidr4(value) !== undefined;
}

export function cidrContains(cidr: string, ip: string): boolean {
  const net = parseCidr4(cidr);
  if (!net || !isValidIPv4(ip)) return false;
  const size = 2 ** (32 - net.prefix);
  const n = toInt(ip);
  return n >= net.network && n < net.network + size;
}

export function hostCidr(ip: string): string {
  return `${ip}/32`;
}

export function isAnySource(cidr: string): boolean {
  const n = normalizeCidr(cidr);
  return n === ANY_IPV4 || n === ANY_IPV6;
}
