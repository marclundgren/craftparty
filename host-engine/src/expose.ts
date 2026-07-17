import dgram from "node:dgram";
import os from "node:os";
import {
  addPortMapping,
  deletePortMapping,
  discoverGateway,
  getExternalIp,
  getSpecificPortMapping,
  UpnpError,
} from "../../preflight/src/upnp.ts";
import { classifyIpv4 } from "../../preflight/src/ip.ts";
import { fetchPublicIp } from "../../preflight/src/public-ip.ts";

const LEASE_SECONDS = 7200;
const MAPPING_DESCRIPTION = "craftparty-control-plane";

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

  // The mapping target must be this machine's address on the interface
  // facing the router — the first private IP in the interface list is
  // often a virtual adapter (WSL/Hyper-V/VPN), and routers reject
  // mappings to an address that isn't the requester's (Netgear: 718).
  const internalClient =
    (await lanIpToward(new URL(gateway.controlUrl).hostname)) ?? pickLanIp();
  if (!internalClient) throw new Error("No LAN IPv4 address found to map to.");

  const add = (leaseSeconds: number) =>
    addPortMapping(gateway, {
      externalPort,
      internalPort: localPort,
      internalClient,
      protocol: "TCP",
      description: MAPPING_DESCRIPTION,
      leaseSeconds,
    });

  const map = async () => {
    try {
      await add(LEASE_SECONDS);
    } catch (err) {
      if (!(err instanceof UpnpError)) throw err;
      // 725 OnlyPermanentLeasesSupported: retry without a lease; close()
      // still deletes the mapping on shutdown.
      if (err.code === 725) return add(0);
      if (err.code !== 718) throw err;
      // 718 ConflictInMappingEntry: someone holds the external port. If
      // it's a previous Craftparty run (stale lease, other machine, or an
      // entry that already points at us), reclaim it; a mapping we didn't
      // create is not ours to delete.
      const existing = await getSpecificPortMapping(
        gateway,
        externalPort,
        "TCP",
      ).catch(() => null);
      if (
        existing &&
        existing.internalClient === internalClient &&
        existing.internalPort === localPort
      ) {
        return; // the port already forwards to us
      }
      if (existing && existing.description !== MAPPING_DESCRIPTION) {
        throw new Error(
          `Router port ${externalPort} is already forwarded to another device ` +
            `(${existing.internalClient}:${existing.internalPort}, "${existing.description}"). ` +
            `Remove that port forward in the router, or uncheck internet play.`,
        );
      }
      // Best-effort: some routers hold conflicting entries that are not
      // visible (or deletable) through UPnP; the retried add decides.
      await deletePortMapping(gateway, externalPort, "TCP").catch(() => {});
      await add(LEASE_SECONDS);
    }
  };
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

/**
 * Local IP of the interface the OS routes toward `host`. A UDP connect
 * sends no packets — it just resolves the route.
 */
function lanIpToward(host: string): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const done = (value: string | null) => {
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve(value);
    };
    socket.on("error", () => done(null));
    try {
      socket.connect(9, host, () => {
        try {
          done(socket.address().address);
        } catch {
          done(null);
        }
      });
    } catch {
      done(null);
    }
  });
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
