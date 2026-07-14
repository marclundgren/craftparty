#!/usr/bin/env node
/**
 * VPN vertical slice: download headscale + tailscale binaries, boot a local
 * headscale control plane, mint an auth key, join it with a userspace
 * tailscaled, and verify the node gets a tailnet IP and reaches Running.
 *
 * This is the shared core of BOTH connection modes — Independent runs this
 * headscale (auto-exposed), Assisted points tailscaled at the shared one.
 *
 * Run: node host-engine/src/vpn-smoke.ts [--verbose]
 */
import net from "node:net";
import { ensureHeadscale, ensureTailscale } from "./binaries.ts";
import { startHeadscale } from "./headscale.ts";
import { startTailscaled } from "./tailscaled.ts";
import { dataDir } from "./platform.ts";

const verbose = process.argv.includes("--verbose");
const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
const log = (msg: string) => console.log(`${stamp()} ${msg}`);
const debug = (line: string) => {
  if (verbose) console.log(`    ${line}`);
};

log(`data dir: ${dataDir()}`);

const [{ headscale, version: hsVersion }, tsBins] = await Promise.all([
  ensureHeadscale(),
  ensureTailscale(),
]);
log(`binaries ready: headscale ${hsVersion}, tailscale ${tsBins.version}`);

const port = await findFreePort(8091);
const hs = await startHeadscale({ binPath: headscale, port, onLog: debug });
log(`headscale healthy at ${hs.url}`);

let ts: Awaited<ReturnType<typeof startTailscaled>> | null = null;
try {
  const authKey = await hs.createAuthKey("party");
  log(`auth key minted for user "party"`);

  ts = await startTailscaled({ bins: tsBins, name: "smoke", onLog: debug });
  log(`tailscaled running (userspace networking, no root)`);

  await ts.up({
    loginServer: hs.url,
    authKey,
    hostname: "craftparty-smoke-host",
  });
  log(`tailscale up accepted`);

  const deadline = Date.now() + 30_000;
  for (;;) {
    const status = await ts.status();
    const ips = status.Self?.TailscaleIPs ?? [];
    if (status.BackendState === "Running" && ips.length > 0) {
      log(`node RUNNING with tailnet IPs: ${ips.join(", ")}`);
      break;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `node never reached Running (state ${status.BackendState})`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const nodes = JSON.parse(await hs.cli(["nodes", "list", "-o", "json"]));
  log(
    `headscale sees ${nodes.length} node(s): ${nodes
      .map((n: { given_name?: string; name?: string }) => n.given_name ?? n.name)
      .join(", ")}`,
  );
  log("VPN slice OK");
} finally {
  if (ts) await ts.stop();
  await hs.stop();
  log("cleaned up (processes stopped; state kept for reuse)");
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, "0.0.0.0", () => srv.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error("No free port found");
}
