// Multiple providers so a single outage doesn't fail the probe.
const PROVIDERS = [
  "https://api.ipify.org",
  "https://icanhazip.com",
  "https://ifconfig.me/ip",
];

export async function fetchPublicIp(timeoutMs = 5000): Promise<string | null> {
  for (const url of PROVIDERS) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": "craftparty-preflight" },
      });
      if (!res.ok) continue;
      const ip = (await res.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
    } catch {
      // try the next provider
    }
  }
  return null;
}
