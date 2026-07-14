import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { dataDir } from "./platform.ts";
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
  const socketPath = path.join(stateDir, "tailscaled.sock");
  await fsp.rm(socketPath, { force: true });

  const proc = spawn(
    opts.bins.tailscaled,
    [
      "--tun=userspace-networking",
      `--socket=${socketPath}`,
      `--statedir=${stateDir}`,
      "--port=0",
      ...(opts.socks5Port
        ? [`--socks5-server=localhost:${opts.socks5Port}`]
        : []),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [proc.stdout!, proc.stderr!]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) opts.onLog?.(line);
      }
    });
  }

  const deadline = Date.now() + 20_000;
  while (!fs.existsSync(socketPath)) {
    if (proc.exitCode !== null) {
      throw new Error(`tailscaled exited during startup (code ${proc.exitCode})`);
    }
    if (Date.now() > deadline) {
      proc.kill("SIGTERM");
      throw new Error("tailscaled socket did not appear within 20s");
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const ts = (args: string[], timeout = 60_000) =>
    execFileAsync(opts.bins.tailscale, [`--socket=${socketPath}`, ...args], {
      timeout,
    });

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
