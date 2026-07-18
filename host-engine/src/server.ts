import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { downloadFile } from "./download.ts";
import { trackChild } from "./pids.ts";
import { resolveLatestFabricServer, type FabricServer } from "./versions.ts";
import { findFreePort } from "./net-util.ts";
import { syncAddons, type AddonJarRef } from "./addons.ts";
import { dataDir } from "./platform.ts";

export interface ServerOptions {
  javaPath: string;
  /** Party/world name; becomes the world directory name. */
  worldName: string;
  /**
   * Mojang requires each server owner to accept the Minecraft EULA
   * (https://aka.ms/MinecraftEULA). The UI must ask the user explicitly.
   */
  acceptEula: boolean;
  /** Marketplace addon jars synced into the world's mods folder. */
  addons?: AddonJarRef[];
  memoryMb?: number;
  port?: number;
  motd?: string;
  onLog?: (line: string) => void;
}

export interface ServerHandle {
  proc: ChildProcess;
  versions: FabricServer;
  worldDir: string;
  port: number;
  /** Resolves when the server logs its "Done" line and accepts players. */
  ready: Promise<void>;
  /** Graceful stop (console `stop`), escalating to SIGTERM after 30s. */
  stop(): Promise<number | null>;
}

export async function ensureServerJar(
  onProgress?: (received: number, total: number | null) => void,
): Promise<{ jarPath: string; versions: FabricServer }> {
  const versions = await resolveLatestFabricServer();
  const jarPath = path.join(
    dataDir(),
    "server",
    `fabric-server-${versions.minecraft}-${versions.loader}.jar`,
  );
  await downloadFile(versions.serverJarUrl, jarPath, { onProgress });
  return { jarPath, versions };
}

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  if (!opts.acceptEula) {
    throw new Error(
      "The Minecraft EULA must be accepted before a server can run.",
    );
  }
  const port = opts.port ?? (await findFreePort(25565));
  const { jarPath, versions } = await ensureServerJar();

  const worldDir = path.join(dataDir(), "worlds", sanitize(opts.worldName));
  await fsp.mkdir(worldDir, { recursive: true });
  await fsp.writeFile(path.join(worldDir, "eula.txt"), "eula=true\n");

  const propsFile = path.join(worldDir, "server.properties");
  if (!fs.existsSync(propsFile)) {
    await fsp.writeFile(
      propsFile,
      [
        `server-port=${port}`,
        `motd=${opts.motd ?? `${opts.worldName} — a Craftparty world`}`,
        // Friends connect over the private tailnet; the vanilla session
        // check still runs so player identities stay verified.
        "online-mode=true",
        "enable-status=true",
        "",
      ].join("\n"),
    );
  } else {
    // The port can change between runs (auto-picked); keep user edits, fix the port.
    const props = await fsp.readFile(propsFile, "utf8");
    await fsp.writeFile(
      propsFile,
      props.replace(/^server-port=.*$/m, `server-port=${port}`),
    );
  }

  await syncAddons(worldDir, opts.addons ?? [], opts.onLog);

  const proc = spawn(
    opts.javaPath,
    [`-Xmx${opts.memoryMb ?? 2048}M`, "-jar", jarPath, "nogui"],
    { cwd: worldDir, stdio: ["pipe", "pipe", "pipe"] },
  );
  trackChild(`minecraft-${opts.worldName}`, proc, jarPath);

  const ready = new Promise<void>((resolve, reject) => {
    let done = false;
    const onLine = (line: string) => {
      opts.onLog?.(line);
      if (!done && /\]: Done \(/.test(line)) {
        done = true;
        resolve();
      }
    };
    lineReader(proc.stdout!, onLine);
    lineReader(proc.stderr!, onLine);
    proc.once("exit", (code) => {
      if (!done) {
        done = true;
        reject(new Error(`Server exited before ready (code ${code})`));
      }
    });
    proc.once("error", (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
  });

  return {
    proc,
    versions,
    worldDir,
    port,
    ready,
    stop: () =>
      new Promise((resolve) => {
        if (proc.exitCode !== null) return resolve(proc.exitCode);
        const killTimer = setTimeout(() => proc.kill("SIGTERM"), 30_000);
        proc.once("exit", (code) => {
          clearTimeout(killTimer);
          resolve(code);
        });
        proc.stdin!.write("stop\n");
      }),
  };
}

function lineReader(stream: NodeJS.ReadableStream, onLine: (l: string) => void) {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      onLine(buf.slice(0, i).trimEnd());
      buf = buf.slice(i + 1);
    }
  });
}

function sanitize(name: string): string {
  const clean = name.trim().replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "-");
  if (!clean) throw new Error(`World name ${JSON.stringify(name)} is not usable`);
  return clean.toLowerCase();
}
