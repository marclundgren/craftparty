import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { dataDir } from "./platform.ts";

const execFileAsync = promisify(execFile);

export interface HeadscaleOptions {
  binPath: string;
  /** Port for the control-plane HTTP listener. */
  port: number;
  /**
   * URL clients will use to reach this control plane. Defaults to the local
   * listener; Independent mode passes the auto-exposed public URL instead.
   */
  serverUrl?: string;
  onLog?: (line: string) => void;
}

export interface HeadscaleHandle {
  proc: ChildProcess;
  url: string;
  stateDir: string;
  cli(args: string[]): Promise<string>;
  /** Create (or reuse) a user and mint a fresh preauth key for it. */
  createAuthKey(user: string, reusable?: boolean): Promise<string>;
  stop(): Promise<number | null>;
}

export async function startHeadscale(
  opts: HeadscaleOptions,
): Promise<HeadscaleHandle> {
  const stateDir = path.join(dataDir(), "vpn", "headscale-state");
  await fsp.mkdir(stateDir, { recursive: true });
  const url = opts.serverUrl ?? `http://127.0.0.1:${opts.port}`;
  const configPath = path.join(stateDir, "config.yaml");

  await fsp.writeFile(
    configPath,
    [
      `server_url: ${url}`,
      `listen_addr: 0.0.0.0:${opts.port}`,
      `metrics_listen_addr: ""`,
      `grpc_listen_addr: 127.0.0.1:0`,
      `noise:`,
      `  private_key_path: ${path.join(stateDir, "noise_private.key")}`,
      `prefixes:`,
      `  v4: 100.64.0.0/10`,
      `  v6: fd7a:115c:a1e0::/48`,
      `derp:`,
      // Zero-infra data relaying: Tailscale's public DERP map, like the kit.
      `  urls: ["https://controlplane.tailscale.com/derpmap/default"]`,
      `  auto_update_enabled: true`,
      `  update_frequency: 24h`,
      `database:`,
      `  type: sqlite`,
      `  sqlite:`,
      `    path: ${path.join(stateDir, "db.sqlite")}`,
      `dns:`,
      `  magic_dns: true`,
      `  base_domain: craft.internal`,
      `  nameservers:`,
      `    global: ["1.1.1.1", "8.8.8.8"]`,
      `unix_socket: ${path.join(stateDir, "headscale.sock")}`,
      `log:`,
      `  level: info`,
      ``,
    ].join("\n"),
  );

  const proc = spawn(opts.binPath, ["serve", "-c", configPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
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

  // Wait for the health endpoint.
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (proc.exitCode !== null) {
      throw new Error(
        `headscale exited during startup (code ${proc.exitCode}):\n${lastLogs.join("\n")}`,
      );
    }
    try {
      const res = await fetch(`http://127.0.0.1:${opts.port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      proc.kill("SIGTERM");
      throw new Error(
        `headscale did not become healthy in 30s:\n${lastLogs.join("\n")}`,
      );
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const cli = async (args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync(opts.binPath, [
      "-c",
      configPath,
      ...args,
    ]);
    return stdout;
  };

  return {
    proc,
    url,
    stateDir,
    cli,
    createAuthKey: async (user, reusable = false) => {
      let userId: string | null = null;
      try {
        const created = JSON.parse(
          await cli(["users", "create", user, "-o", "json"]),
        );
        userId = String(created.id ?? user);
      } catch {
        // user probably exists — look it up
        const users = JSON.parse(await cli(["users", "list", "-o", "json"]));
        const found = Array.isArray(users)
          ? users.find((u: { name?: string }) => u.name === user)
          : null;
        if (!found) throw new Error(`Could not create or find user ${user}`);
        userId = String(found.id ?? user);
      }
      const key = JSON.parse(
        await cli([
          "preauthkeys",
          "create",
          "--user",
          userId,
          `--reusable=${reusable}`,
          "--expiration",
          "1h",
          "-o",
          "json",
        ]),
      );
      if (!key.key) throw new Error(`No key in preauthkeys output`);
      return key.key as string;
    },
    stop: () =>
      new Promise((resolve) => {
        if (proc.exitCode !== null) return resolve(proc.exitCode);
        proc.once("exit", (code) => resolve(code));
        proc.kill("SIGTERM");
      }),
  };
}
