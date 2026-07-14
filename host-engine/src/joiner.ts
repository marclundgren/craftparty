import crypto from "node:crypto";
import net from "node:net";
import { ensureTailscale } from "./binaries.ts";
import { findFreePort } from "./net-util.ts";
import { decodeInvite, type Invite } from "./party.ts";
import { socks5Connect } from "./socks.ts";
import { startTailscaled, type TailscaledHandle } from "./tailscaled.ts";

export interface JoinOptions {
  onPhase?: (phase: string) => void;
  onLog?: (source: "tailscale", line: string) => void;
}

export interface JoinHandle {
  invite: Invite;
  /** Where the friend's Minecraft connects: 127.0.0.1:localPort. */
  localPort: number;
  vpn: TailscaledHandle;
  stop(): Promise<void>;
}

/**
 * Join a party from an invite code: join the host's tailnet with a
 * userspace tailscaled (no admin rights), then run a local TCP proxy so
 * Minecraft can simply connect to localhost — the proxy dials into the
 * tailnet through the tailscaled SOCKS5 exit.
 */
export async function joinParty(
  inviteCode: string,
  opts: JoinOptions = {},
): Promise<JoinHandle> {
  const phase = (p: string) => opts.onPhase?.(p);
  const invite = decodeInvite(inviteCode);

  phase("fetching runtimes");
  const bins = await ensureTailscale();

  phase("joining the party network");
  const socksPort = await findFreePort(3055, "127.0.0.1");
  const vpn = await startTailscaled({
    bins,
    // Per-party state: joining two different parties (or a selftest
    // joining alongside a real one) must not share a tailscaled identity.
    name: `joiner-${invite.party.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
    socks5Port: socksPort,
    onLog: (l) => opts.onLog?.("tailscale", l),
  });

  try {
    await vpn.up({
      loginServer: invite.controlPlaneUrl,
      authKey: invite.authKey,
      hostname: `friend-${crypto.randomBytes(2).toString("hex")}`,
    });
    const deadline = Date.now() + 30_000;
    for (;;) {
      const status = await vpn.status();
      if (status.BackendState === "Running") break;
      if (Date.now() > deadline) {
        throw new Error(`Never reached Running (${status.BackendState})`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    phase("connecting to the world");
    const localPort = await findFreePort(25565, "127.0.0.1");
    const proxy = net.createServer((client) => {
      socks5Connect(socksPort, invite.server.host, invite.server.port)
        .then((remote) => {
          client.pipe(remote);
          remote.pipe(client);
          const drop = () => {
            client.destroy();
            remote.destroy();
          };
          client.on("error", drop);
          remote.on("error", drop);
          client.on("close", drop);
          remote.on("close", drop);
        })
        .catch(() => client.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(localPort, "127.0.0.1", resolve);
    });

    phase("ready");
    return {
      invite,
      localPort,
      vpn,
      stop: async () => {
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
        await vpn.stop();
      },
    };
  } catch (err) {
    await vpn.stop().catch(() => {});
    throw err;
  }
}
