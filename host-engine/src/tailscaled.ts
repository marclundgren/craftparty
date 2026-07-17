import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { dataDir } from "./platform.ts";
import { trackChild } from "./pids.ts";
import type { TailscaleBins } from "./binaries.ts";

const execFileAsync = promisify(execFile);

export interface TailscaledOptions {
  bins: TailscaleBins;
  /** Instance name; state and socket live under vpn/ts-<name>. */
  name: string;
  /**
   * Expose a local SOCKS5 proxy on this port. In userspace mode this is how
   * local apps dial INTO the tailnet (the joiner points Minecraft through it).
   */
  socks5Port?: number;
  onLog?: (line: string) => void;
}

export interface UpOptions {
  loginServer: string;
  authKey: string;
  hostname: string;
}

export interface TailscaledHandle {
  proc: ChildProcess;
  socketPath: string;
  up(opts: UpOptions): Promise<void>;
  status(): Promise<TailscaleStatus>;
  stop(): Promise<number | null>;
}

export interface TailscaleStatus {
  BackendState: string;
  Self?: { TailscaleIPs?: string[]; DNSName?: string };
  Peer?: Record<string, { HostName: string; TailscaleIPs: string[]; Online: boolean }>;
}

/**
 * Run tailscaled in userspace-networking mode: no root, no TUN device —
 * exactly how the desktop app will embed it.
 */
export async function startTailscaled(
  opts: TailscaledOptions,
): Promise<TailscaledHandle> {
  const stateDir = path.join(dataDir(), "vpn", `ts-${opts.name}`);
  await fsp.mkdir(stateDir, { recursive: true });
  // Windows tailscaled listens on a named pipe, not a filesystem socket.
  const isWindows = process.platform === "win32";
  const socketPath = isWindows
    ? `\\\\.\\pipe\\craftparty-ts-${opts.name}`
    : path.join(stateDir, "tailscaled.sock");
  if (!isWindows) await fsp.rm(socketPath, { force: true });

  const proc = spawn(
    opts.bins.tailscaled,
    [
      "--tun=userspace-networking",
      `--socket=${socketPath}`,
      `--statedir=${stateDir}`,
      "--port=0",
      "--no-logs-no-support",
      ...(opts.socks5Port
        ? [`--socks5-server=localhost:${opts.socks5Port}`]
        : []),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  trackChild(`tailscaled-${opts.name}`, proc, stateDir);
  let lastLogs: string[] = [];
  for (const stream of [proc.stdout!, proc.stderr!]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        lastLogs = [...lastLogs.slice(-19), line];
        opts.onLog?.(line);
      }
    });
  }

  const ts = (args: string[], timeout = 60_000) =>
    execFileAsync(opts.bins.tailscale, [`--socket=${socketPath}`, ...args], {
      timeout,
    });

  // Ready when the CLI can reach the daemon (a named pipe never shows up
  // via fs, so probing with the CLI is the portable readiness check).
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (proc.exitCode !== null) {
      throw new Error(
        `tailscaled exited during startup (code ${proc.exitCode}):\n${lastLogs.join("\n")}`,
      );
    }
    if (isWindows || fs.existsSync(socketPath)) {
      try {
        await ts(["status", "--json"], 3000);
        break;
      } catch {
        // daemon not accepting connections yet
      }
    }
    if (Date.now() > deadline) {
      proc.kill("SIGTERM");
      throw new Error(
        `tailscaled did not become reachable within 20s:\n${lastLogs.join("\n")}`,
      );
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  return {
    proc,
    socketPath,
    up: async ({ loginServer, authKey, hostname }) => {
      await ts(
        [
          "up",
          `--login-server=${loginServer}`,
          `--auth-key=${authKey}`,
          `--hostname=${hostname}`,
          "--accept-dns=false",
        ],
        120_000,
      );
    },
    status: async () => {
      const { stdout } = await ts(["status", "--json"]);
      return JSON.parse(stdout) as TailscaleStatus;
    },
    stop: () =>
      new Promise((resolve) => {
        if (proc.exitCode !== null) return resolve(proc.exitCode);
        proc.once("exit", (code) => resolve(code));
        proc.kill("SIGTERM");
      }),
  };
}
