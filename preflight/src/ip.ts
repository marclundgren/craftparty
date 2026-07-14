export type IpKind =
  | "public"
  | "private"
  | "cgnat"
  | "loopback"
  | "link-local"
  | "invalid";

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const b = Number(p);
    if (!Number.isInteger(b) || b < 0 || b > 255 || p !== String(b)) {
      return null;
    }
    n = n * 256 + b;
  }
  return n;
}

const RANGES: Array<[base: string, bits: number, kind: IpKind]> = [
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local"],
  ["10.0.0.0", 8, "private"],
  ["172.16.0.0", 12, "private"],
  ["192.168.0.0", 16, "private"],
  // RFC 6598 shared address space: the definitive CGNAT signal.
  ["100.64.0.0", 10, "cgnat"],
];

export function classifyIpv4(ip: string): IpKind {
  const n = ipv4ToInt(ip);
  if (n === null) return "invalid";
  for (const [base, bits, kind] of RANGES) {
    const b = ipv4ToInt(base)!;
    const mask = (~0 << (32 - bits)) >>> 0;
    if (((n & mask) >>> 0) === ((b & mask) >>> 0)) return kind;
  }
  return "public";
}
