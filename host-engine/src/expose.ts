import os from "node:os";
import {
  addPortMapping,
  deletePortMapping,
  discoverGateway,
  getExternalIp,
  type Gateway,
} from "../../preflight/src/upnp.ts";
import { classifyIpv4 } from "../../preflight/src/ip.ts";
import { fetchPublicIp } from "../../preflight/src/public-ip.ts";

const LEASE_SECONDS = 7200;

export interface Exposure {
  publicUrl: string;
  publicIp: string;
  externalPort: number;
  close(): Promise<void>;
}

export interface ExposeOptions {
  /** External (router) port; defaults to the local port. 443 for TLS. */
  externalPort?: number;
}

/**
 * Auto-expose a local TCP port to the internet via UPnP, renewing the lease
 * at half-life. Fails loudly (with the preflight-style reason) when the
 * network can't support it — the caller falls back to Assisted mode.
 */
export async function exposePort(
  localPort: number,
  opts: ExposeOptions = {},
): Promise<Exposure> {
  const externalPort = opts.externalPort ?? localPort;
  const [gateway, publicIp] = await Promise.all([
    discoverGateway(),
    fetchPublicIp(),
  ]);
  if (!gateway) {
    throw new Error(
      "No UPnP gateway answered — this network can't auto-expose (use Assisted mode).",
    );
  }
  if (!publicIp) {
    throw new Error("Could not determine the public IP — is the machine online?");
  }
  if (classifyIpv4(publicIp) === "cgnat") {
    throw new Error(
      "The public IP is carrier-grade NAT — auto-expose can't work here (use Assisted mode).",
    );
  }
  const routerIp = await getExternalIp(gateway).catch(() => null);
  if (routerIp && classifyIpv4(routerIp) !== "public") {
    throw new Error(
      `Router external address ${routerIp} is not public (double NAT) — use Assisted mode.`,
    );
  }

  const internalClient = pickLanIp();
  if (!internalClient) throw new Error("No LAN IPv4 address found to map to.");

  const map = () =>
    addPortMapping(gateway, {
      externalPort,
      internalPort: localPort,
      internalClient,
      protocol: "TCP",
      description: "craftparty-control-plane",
      leaseSeconds: LEASE_SECONDS,
    });
  await map();

  const renewTimer = setInterval(
    () => {
      map().catch(() => {
        // Renewal failure is recoverable until the lease actually expires;
        // the next tick retries.
      });
    },
    (LEASE_SECONDS / 2) * 1000,
  );
  renewTimer.unref();

  return {
    publicUrl: `http://${publicIp}:${externalPort}`,
    publicIp,
    externalPort,
    close: async () => {
      clearInterval(renewTimer);
      await deletePortMapping(gateway, externalPort, "TCP").catch(() => {});
    },
  };
}

function pickLanIp(): string | null {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal && classifyIpv4(a.address) === "private") {
        return a.address;
      }
    }
  }
  return null;
}
