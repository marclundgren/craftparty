import { exposePort, type Exposure } from "./expose.ts";
import { findFreePort } from "./net-util.ts";
import { ensureJre } from "./jre.ts";
import { startServer, type ServerHandle } from "./server.ts";
import { ensureHeadscale, ensureTailscale } from "./binaries.ts";
import { startHeadscale, type HeadscaleHandle } from "./headscale.ts";
import { startTailscaled, type TailscaledHandle } from "./tailscaled.ts";
import type { AddonJarRef } from "./addons.ts";

export type ConnectMode = "independent" | "assisted";

/** Everything a friend needs to join; travels as a base64url party code. */
export interface Invite {
  v: 1;
  party: string;
  controlPlaneUrl: string;
  /** Reusable preauth key friends' tailscale clients log in with. */
  authKey: string;
  server: { host: string; port: number };
}

export function encodeInvite(invite: Invite): string {
  return Buffer.from(JSON.stringify(invite)).toString("base64url");
}

export function decodeInvite(code: string): Invite {
  const invite = JSON.parse(
    Buffer.from(code.trim(), "base64url").toString("utf8"),
  ) as Invite;
  if (invite.v !== 1 || !invite.controlPlaneUrl || !invite.authKey) {
    throw new Error("Not a valid Craftparty invite code");
  }
  return invite;
}

export interface PartyOptions {
  worldName: string;
  /** Mojang requires explicit acceptance — the UI must ask. */
  acceptEula: boolean;
  mode: ConnectMode;
  /**
   * Independent mode only: auto-expose the control plane to the internet
   * via UPnP so remote friends can join. false = LAN/local-only party.
   */
  remote?: boolean;
  /**
   * Assisted mode: credentials for the shared control plane (minted by its
   * party-registration API; that service is built separately).
   */
  assisted?: {
    controlPlaneUrl: string;
    hostAuthKey: string;
    friendAuthKey: string;
  };
  /** Marketplace addon jars to install into the world before launch. */
  addons?: AddonJarRef[];
  memoryMb?: number;
  motd?: string;
  onLog?: (source: "headscale" | "tailscale" | "minecraft", line: string) => void;
  onPhase?: (phase: string) => void;
}

export interface PartyHandle {
  mode: ConnectMode;
  invite: Invite;
  inviteCode: string;
  tailnetIp: string;
  server: ServerHandle;
  vpn: TailscaledHandle;
  headscale: HeadscaleHandle | null;
  stop(): Promise<void>;
}

/**
 * Boot a complete party: control plane (Independent) or shared control
 * plane (Assisted), join the tailnet, start Minecraft, emit the invite.
 *
 * NOTE (Independent mode, current state): remote=false is fully working
 * (LAN/local). remote=true exposes the control plane via UPnP and is
 * VERIFIED REACHABLE over the public URL, but the tailscale client
 * refuses plain-http control planes on non-loopback addresses (it forces
 * an https dial after the first noise connection), so remote needs the
 * TLS layer (headscale built-in Let's Encrypt + sslip.io hostname +
 * external 443 mapping) before it works end to end.
 */
export async function startParty(opts: PartyOptions): Promise<PartyHandle> {
  const phase = (p: string) => opts.onPhase?.(p);
  const cleanups: Array<() => Promise<unknown>> = [];

  try {
    phase("fetching runtimes");
    const [tsBins, jre] = await Promise.all([ensureTailscale(), ensureJre()]);

    let headscale: HeadscaleHandle | null = null;
    let controlPlaneUrl: string;
    let hostAuthKey: string;
    let friendAuthKey: string;

    if (opts.mode === "independent") {
      phase("starting control plane");
      const hsBin = await ensureHeadscale();
      const hsPort = await findFreePort(8091);

      let exposure: Exposure | null = null;
      let tls: { hostname: string; acmeUrl?: string } | undefined;
      let serverUrl: string | undefined;
      if (opts.remote) {
        phase("opening a door in the router");
        // The tailscale client requires https for non-loopback control
        // planes, so remote mode is TLS: external 443 → local port, with
        // an IP-derived sslip.io hostname and a built-in ACME cert.
        exposure = await exposePort(hsPort, { externalPort: 443 });
        cleanups.push(() => exposure!.close());
        const hostname = `${exposure.publicIp.replaceAll(".", "-")}.sslip.io`;
        tls = { hostname, acmeUrl: process.env.CRAFTPARTY_ACME_URL };
        serverUrl = `https://${hostname}`;
        phase("getting a certificate (first time can take a minute)");
      }

      headscale = await startHeadscale({
        binPath: hsBin.headscale,
        name: opts.worldName,
        port: hsPort,
        serverUrl,
        tls,
        onLog: (l) => opts.onLog?.("headscale", l),
      });
      cleanups.push(() => headscale!.stop());
      controlPlaneUrl = headscale.url;
      hostAuthKey = await headscale.createAuthKey("host");
      friendAuthKey = await headscale.createAuthKey("friends", {
        reusable: true,
        expiration: "720h",
      });
    } else {
      if (!opts.assisted) {
        throw new Error("Assisted mode needs shared control-plane credentials");
      }
      ({ controlPlaneUrl, hostAuthKey, friendAuthKey } = opts.assisted);
    }

    phase("joining private network");
    const vpn = await startTailscaled({
      bins: tsBins,
      name: `host-${opts.worldName}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      onLog: (l) => opts.onLog?.("tailscale", l),
    });
    cleanups.push(() => vpn.stop());
    await vpn.up({
      loginServer: controlPlaneUrl,
      authKey: hostAuthKey,
      hostname: `party-${opts.worldName}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    });

    const tailnetIp = await waitForTailnetIp(vpn);

    phase("starting Minecraft");
    const server = await startServer({
      javaPath: jre.javaPath,
      worldName: opts.worldName,
      acceptEula: opts.acceptEula,
      addons: opts.addons,
      memoryMb: opts.memoryMb,
      motd: opts.motd,
      onLog: (l) => opts.onLog?.("minecraft", l),
    });
    cleanups.push(() => server.stop());
    await server.ready;

    const invite: Invite = {
      v: 1,
      party: opts.worldName,
      controlPlaneUrl,
      authKey: friendAuthKey,
      server: { host: tailnetIp, port: server.port },
    };

    phase("ready");
    return {
      mode: opts.mode,
      invite,
      inviteCode: encodeInvite(invite),
      tailnetIp,
      server,
      vpn,
      headscale,
      stop: async () => {
        for (const cleanup of cleanups.reverse()) {
          await cleanup().catch(() => {});
        }
      },
    };
  } catch (err) {
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => {});
    }
    throw err;
  }
}

async function waitForTailnetIp(vpn: TailscaledHandle): Promise<string> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const status = await vpn.status();
    const ip = status.Self?.TailscaleIPs?.find((i) => i.includes("."));
    if (status.BackendState === "Running" && ip) return ip;
    if (Date.now() > deadline) {
      throw new Error(
        `Never got a tailnet IP (state ${status.BackendState})`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

