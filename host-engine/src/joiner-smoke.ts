#!/usr/bin/env node
/**
 * Joiner vertical slice: host a party (engine), join it with joinParty(),
 * then connect PLAIN TCP to the joiner's localhost proxy — exactly what
 * the friend's Minecraft does — and expect a Minecraft status reply.
 *
 * Run: node host-engine/src/joiner-smoke.ts [--verbose]
 */
import net from "node:net";
import { startParty } from "./party.ts";
import { joinParty } from "./joiner.ts";
import { minecraftStatus } from "./mc-ping.ts";

const verbose = process.argv.includes("--verbose");
const t0 = Date.now();
const log = (msg: string) =>
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
const debug = (src: string) => (line: string) => {
  if (verbose) console.log(`    [${src}] ${line}`);
};

const party = await startParty({
  worldName: "joiner-smoke",
  acceptEula: true,
  mode: "independent",
  onPhase: (p) => log(`host: ${p}`),
});
log(`host: up (invite ${party.inviteCode.length} chars)`);

let join: Awaited<ReturnType<typeof joinParty>> | null = null;
try {
  join = await joinParty(party.inviteCode, {
    onPhase: (p) => log(`friend: ${p}`),
    onLog: (_s, l) => debug("friend-ts")(l),
  });
  log(`friend: proxy ready on localhost:${join.localPort}`);

  // What Minecraft does: a plain TCP connection to localhost.
  const socket = net.connect({ host: "127.0.0.1", port: join.localPort });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const status = await minecraftStatus(socket, "127.0.0.1", join.localPort);
  socket.destroy();
  log(
    `friend: Minecraft answered on localhost — version ${status.version?.name}`,
  );
  log("JOINER SLICE OK");
} finally {
  if (join) await join.stop();
  await party.stop();
  log("cleaned up");
}
