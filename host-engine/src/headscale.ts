import fsp from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { dataDir } from "./platform.ts";

const execFileAsync = promisify(execFile);

/**
 * Local health check. For TLS we connect to loopback with the public
 * hostname as SNI and skip chain verification — this is a liveness probe
 * of our own child process, not a trust decision.
 */
function healthOk(port: number, tlsHostname?: string): Promise<boolean> {
  if (!tlsHostname) {
    return fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    })
      .then((res) => res.ok)
      .catch(() => false);
  }
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: "127.0.0.1",
        port,
        path: "/health",
        servername: tlsHostname,
        rejectUnauthorized: false,
        timeout: 3000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

export interface HeadscaleOptions {
  binPath: string;
  /** Port for the control-plane listener. */
  port: number;
  /**
   * Instance name; state lives under vpn/headscale-<name>. Distinct names
   * let multiple parties/app instances coexist without dueling over one
   * sqlite database and config file.
   */
  name?: string;
  /**
   * URL clients will use to reach this control plane. Defaults to the local
   * listener; Independent mode passes the auto-exposed public URL instead.
   */
  serverUrl?: string;
  /**
   * Serve TLS with a built-in Let's Encrypt cert (TLS-ALPN-01: the
   * challenge arrives on the same listener, so external 443 must already
   * be mapped to `port`). acmeUrl overrides the CA (LE staging in tests).
   */
  tls?: { hostname: string; acmeUrl?: string };
  onLog?: (line: string) => void;
}

export interface HeadscaleHandle {
  proc: ChildProcess;
  url: string;
  stateDir: string;
  cli(args: string[]): Promise<string>;
  /** Create (or reuse) a user and mint a fresh preauth key for it. */
  createAuthKey(
    user: string,
    opts?: { reusable?: boolean; expiration?: string },
  ): Promise<string>;
  stop(): Promise<number | null>;
}

export async function startHeadscale(
  opts: HeadscaleOptions,
): Promise<HeadscaleHandle> {
  const stateDir = path.join(
    dataDir(),
    "vpn",
    `headscale-${(opts.name ?? "default").toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
  );
  await fsp.mkdir(stateDir, { recursive: true });
  const url = opts.serverUrl ?? `http://127.0.0.1:${opts.port}`;
  const configPath = path.join(stateDir, "config.yaml");

  // Separate cert caches per CA — a cached staging cert must never be
  // served when running against the production CA. The cache is SHARED
  // across instances (not per-world) so certs are never re-issued per
  // party: Let's Encrypt rate limits are real.
  const caSlug = opts.tls?.acmeUrl
    ? new URL(opts.tls.acmeUrl).hostname.replace(/[^a-z0-9.-]/gi, "_")
    : "prod";
  const tlsLines = opts.tls
    ? [
        `tls_letsencrypt_hostname: ${opts.tls.hostname}`,
        `tls_letsencrypt_cache_dir: ${path.join(dataDir(), "vpn", `letsencrypt-${caSlug}`)}`,
        `tls_letsencrypt_challenge_type: TLS-ALPN-01`,
        ...(opts.tls.acmeUrl ? [`acme_url: ${opts.tls.acmeUrl}`] : []),
      ]
    : [];

  await fsp.writeFile(
    configPath,
    [
      `server_url: ${url}`,
      `listen_addr: 0.0.0.0:${opts.port}`,
      ...tlsLines,
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

  // Wait for the health endpoint. With TLS the first check also triggers
  // ACME issuance, which takes longer.
  const startupMs = opts.tls ? 180_000 : 30_000;
  const deadline = Date.now() + startupMs;
  for (;;) {
    if (proc.exitCode !== null) {
      throw new Error(
        `headscale exited during startup (code ${proc.exitCode}):\n${lastLogs.join("\n")}`,
      );
    }
    if (await healthOk(opts.port, opts.tls?.hostname)) break;
    if (Date.now() > deadline) {
      proc.kill("SIGTERM");
      throw new Error(
        `headscale did not become healthy in ${startupMs / 1000}s:\n${lastLogs.join("\n")}`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
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
    createAuthKey: async (user, keyOpts = {}) => {
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
          `--reusable=${keyOpts.reusable ?? false}`,
          "--expiration",
          keyOpts.expiration ?? "1h",
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
