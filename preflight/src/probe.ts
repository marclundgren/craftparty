import os from "node:os";
import net from "node:net";
import fs from "node:fs";
import { classifyIpv4, type IpKind } from "./ip.ts";
import { fetchPublicIp } from "./public-ip.ts";
import {
  addPortMapping,
  deletePortMapping,
  discoverGateway,
  getExternalIp,
  type Gateway,
} from "./upnp.ts";

export type Verdict = "independent" | "independent-maybe" | "assisted";

export interface ProbeReport {
  insideVm: boolean;
  localIps: Array<{ iface: string; address: string; kind: IpKind }>;
  publicIp: string | null;
  publicIpKind: IpKind | null;
  upnp: {
    found: boolean;
    friendlyName: string | null;
    externalIp: string | null;
    externalIpKind: IpKind | null;
  };
  mappingTest: {
    ran: boolean;
    mapped: boolean;
    loopbackReached: boolean | null;
    error: string | null;
  };
  verdict: Verdict;
  reasons: string[];
  warnings: string[];
}

export interface ProbeOptions {
  timeoutMs?: number;
  runMappingTest?: boolean;
  testPort?: number;
}

export async function probe(opts: ProbeOptions = {}): Promise<ProbeReport> {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const testPort = opts.testPort ?? 25877;

  const report: ProbeReport = {
    insideVm: detectWslOrVm(),
    localIps: listLocalIps(),
    publicIp: null,
    publicIpKind: null,
    upnp: {
      found: false,
      friendlyName: null,
      externalIp: null,
      externalIpKind: null,
    },
    mappingTest: { ran: false, mapped: false, loopbackReached: null, error: null },
    verdict: "assisted",
    reasons: [],
    warnings: [],
  };

  if (report.insideVm) {
    report.warnings.push(
      "Running inside WSL/a VM: this probe sees the VM's virtual network, " +
        "not the physical machine's. Results may be more pessimistic than reality.",
    );
  }

  const [publicIp, gateway] = await Promise.all([
    fetchPublicIp(timeoutMs),
    discoverGateway(timeoutMs),
  ]);

  report.publicIp = publicIp;
  report.publicIpKind = publicIp ? classifyIpv4(publicIp) : null;
  if (!publicIp) {
    report.warnings.push(
      "Could not determine the public IP (offline, or IP services unreachable).",
    );
  }

  if (gateway) {
    report.upnp.found = true;
    report.upnp.friendlyName = gateway.friendlyName;
    try {
      const ext = await getExternalIp(gateway);
      report.upnp.externalIp = ext;
      report.upnp.externalIpKind = ext ? classifyIpv4(ext) : null;
    } catch (err) {
      report.warnings.push(
        `UPnP gateway found but GetExternalIPAddress failed: ${message(err)}`,
      );
    }

    if (opts.runMappingTest) {
      await runMappingTest(gateway, testPort, report);
    }
  }

  decide(report);
  return report;
}

async function runMappingTest(
  gateway: Gateway,
  port: number,
  report: ProbeReport,
): Promise<void> {
  report.mappingTest.ran = true;
  const internalClient = pickInternalClient(report);
  if (!internalClient) {
    report.mappingTest.error = "No suitable local IPv4 address to map to.";
    return;
  }

  const server = net.createServer((socket) => socket.end());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", resolve);
    });
    await addPortMapping(gateway, {
      externalPort: port,
      internalPort: port,
      internalClient,
      protocol: "TCP",
      description: "craftparty-preflight",
      leaseSeconds: 120,
    });
    report.mappingTest.mapped = true;

    // Best-effort: connect to our own public IP. Many routers don't support
    // hairpin NAT, so failure here is inconclusive, not damning.
    if (report.publicIp) {
      report.mappingTest.loopbackReached = await canConnect(
        report.publicIp,
        port,
        4000,
      );
    }
  } catch (err) {
    report.mappingTest.error = message(err);
  } finally {
    server.close();
    if (report.mappingTest.mapped) {
      try {
        await deletePortMapping(gateway, port, "TCP");
      } catch {
        report.warnings.push(
          `Could not remove the test port mapping (${port}/TCP); its 120s lease will expire on its own.`,
        );
      }
    }
  }
}

function canConnect(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function decide(report: ProbeReport): void {
  const reasons = report.reasons;

  if (report.publicIpKind === "cgnat") {
    report.verdict = "assisted";
    reasons.push(
      "The public IP is in 100.64.0.0/10 (carrier-grade NAT). The ISP gives no inbound path; Independent mode cannot work here.",
    );
    return;
  }

  if (!report.upnp.found) {
    report.verdict = "assisted";
    reasons.push(
      "No UPnP gateway answered, so ports can't be opened automatically. Independent mode would need manual port forwarding.",
    );
    return;
  }

  if (
    report.upnp.externalIpKind &&
    report.upnp.externalIpKind !== "public"
  ) {
    report.verdict = "assisted";
    reasons.push(
      `The router's external address (${report.upnp.externalIp}) is not a public IP — double NAT or CGNAT sits above it. Opening ports on this router won't reach the internet.`,
    );
    return;
  }

  if (
    report.publicIp &&
    report.upnp.externalIp &&
    report.upnp.externalIp !== report.publicIp
  ) {
    report.verdict = "independent-maybe";
    reasons.push(
      `The router reports external IP ${report.upnp.externalIp} but the internet sees ${report.publicIp} — there may be another NAT layer above the router.`,
    );
    return;
  }

  if (report.mappingTest.loopbackReached === true) {
    report.verdict = "independent";
    reasons.push(
      "UPnP works, the router holds a public IP, and a test port mapping was reachable. Independent mode should work.",
    );
    return;
  }

  if (report.mappingTest.ran && !report.mappingTest.mapped) {
    report.verdict = "independent-maybe";
    reasons.push(
      `UPnP gateway found but creating a port mapping failed (${report.mappingTest.error ?? "unknown error"}). UPnP may be disabled on the router.`,
    );
    return;
  }

  report.verdict = "independent-maybe";
  reasons.push(
    "UPnP works and the router holds a public IP. Inbound reachability wasn't fully verified" +
      (report.mappingTest.ran
        ? " (self-connection test inconclusive — many routers don't support hairpin NAT)"
        : " (run with --map to test a real port mapping)") +
      ".",
  );
}

function listLocalIps(): ProbeReport["localIps"] {
  const out: ProbeReport["localIps"] = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      out.push({ iface, address: a.address, kind: classifyIpv4(a.address) });
    }
  }
  return out;
}

function pickInternalClient(report: ProbeReport): string | null {
  const preferred = report.localIps.find((ip) => ip.kind === "private");
  return (preferred ?? report.localIps[0])?.address ?? null;
}

function detectWslOrVm(): boolean {
  try {
    return /microsoft/i.test(fs.readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
