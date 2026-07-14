#!/usr/bin/env node
/**
 * Vertical-slice smoke test for the native-process engine:
 * resolve versions → download JRE + Fabric server jar → boot a real
 * Minecraft server → wait for ready → verify the port answers → stop.
 *
 * Run: node host-engine/src/smoke.ts [--verbose]
 * (accepting the Minecraft EULA on your own behalf)
 */
import net from "node:net";
import { ensureJre } from "./jre.ts";
import { startServer } from "./server.ts";
import { dataDir } from "./platform.ts";

const verbose = process.argv.includes("--verbose");
const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

console.log(`${stamp()} data dir: ${dataDir()}`);

const jre = await ensureJre(progress("JRE"));
console.log(
  `${stamp()} java ready: ${jre.releaseName} (Java ${jre.featureVersion})`,
);

const server = await startServer({
  javaPath: jre.javaPath,
  worldName: "smoke-test",
  acceptEula: true,
  memoryMb: 2048,
  onLog: (line) => {
    if (verbose) console.log(`    ${line}`);
  },
});
console.log(
  `${stamp()} server spawned: Minecraft ${server.versions.minecraft}, Fabric loader ${server.versions.loader}`,
);
console.log(`${stamp()} world dir: ${server.worldDir}`);

const timeout = setTimeout(
  () => {
    console.error(`${stamp()} FAIL: server not ready within 10 minutes`);
    process.exit(1);
  },
  10 * 60_000,
);

try {
  await server.ready;
  clearTimeout(timeout);
  console.log(`${stamp()} server READY`);

  const reachable = await new Promise<boolean>((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port: server.port, timeout: 3000 });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
    s.once("timeout", () => (s.destroy(), resolve(false)));
  });
  console.log(
    `${stamp()} port ${server.port} ${reachable ? "accepting connections" : "NOT reachable"}`,
  );

  const code = await server.stop();
  console.log(`${stamp()} server stopped (exit code ${code})`);
  process.exit(reachable ? 0 : 1);
} catch (err) {
  clearTimeout(timeout);
  console.error(`${stamp()} FAIL:`, err);
  process.exit(1);
}

function progress(label: string) {
  let lastPct = -10;
  return (received: number, total: number | null) => {
    if (!total) return;
    const pct = Math.floor((received / total) * 100);
    if (pct >= lastPct + 10) {
      lastPct = pct;
      console.log(`${stamp()} ${label} download ${pct}%`);
    }
  };
}
