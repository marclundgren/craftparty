#!/usr/bin/env node
/**
 * End-to-end party smoke test — the whole product in one script:
 *
 *   HOST side:   startParty() → control plane + tailnet + Minecraft + invite
 *   FRIEND side: decode invite → own tailscaled joins with the invite's key
 *                → Minecraft status ping through the tailnet
 *
 * Run: node host-engine/src/party-smoke.ts [--verbose] [--remote]
 *
 * --remote: auto-expose the control plane via UPnP and hand the friend a
 * PUBLIC http://<public-ip>:<port> control-plane URL (exercises the full
 * zero-infra remote path; needs a router with hairpin NAT to self-test).
 */
import net from "node:net";
import { startParty, decodeInvite } from "./party.ts";
import { ensureTailscale } from "./binaries.ts";
import { startTailscaled } from "./tailscaled.ts";
import { socks5Connect } from "./socks.ts";
import { minecraftStatus } from "./mc-ping.ts";

const verbose = process.argv.includes("--verbose");
const remote = process.argv.includes("--remote");
const t0 = Date.now();
const log = (msg: string) =>
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

// ---- HOST ----
const party = await startParty({
  worldName: "party-smoke",
  acceptEula: true,
  mode: "independent",
  remote,
  onPhase: (p) => log(`host: ${p}`),
  onLog: (src, line) => {
    if (verbose) console.log(`    [${src}] ${line}`);
  },
});
log(`host: party up — tailnet IP ${party.tailnetIp}, MC port ${party.server.port}`);
log(`host: invite code (${party.inviteCode.length} chars): ${party.inviteCode.slice(0, 48)}…`);

let friend: Awaited<ReturnType<typeof startTailscaled>> | null = null;
try {
  // ---- FRIEND ----
  const invite = decodeInvite(party.inviteCode);
  log(
    `friend: decoded invite for party "${invite.party}" (control plane ${invite.controlPlaneUrl})`,
  );

  const socksPort = await findFreePort(1080);
  friend = await startTailscaled({
    bins: await ensureTailscale(),
    name: "friend-smoke",
    socks5Port: socksPort,
    onLog: (l) => {
      if (verbose) console.log(`    [friend-ts] ${l}`);
    },
  });
  await friend.up({
    loginServer: invite.controlPlaneUrl,
    authKey: invite.authKey,
    hostname: "friends-laptop",
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    const s = await friend.status();
    if (s.BackendState === "Running") break;
    if (Date.now() > deadline) throw new Error("friend node never Running");
    await new Promise((r) => setTimeout(r, 500));
  }
  log(`friend: joined the tailnet via invite`);

  const socket = await socks5Connect(
    socksPort,
    invite.server.host,
    invite.server.port,
    15_000,
  );
  log(`friend: TCP reached ${invite.server.host}:${invite.server.port} through the tailnet`);

  const status = await minecraftStatus(
    socket,
    invite.server.host,
    invite.server.port,
  );
  socket.destroy();
  log(
    `friend: Minecraft answered — version ${status.version?.name}, max players ${status.players?.max}`,
  );
  log("PARTY SLICE OK");
} finally {
  if (friend) await friend.stop();
  await party.stop();
  log("cleaned up");
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error("No free port found");
}
