import net from "node:net";
import { minecraftStatus, motdText } from "./mc-ping.ts";

/**
 * Is a party up, and how well? Two different questions, answered by two
 * different probes, because a friend is only sometimes connected:
 *
 * - Connected: the joiner's local proxy is listening, so a real
 *   server-list ping goes all the way to the host's Minecraft — version,
 *   who's on, and a round-trip time through the tailnet.
 * - Not connected: there is no route into the host's tailnet, so the
 *   most that can be asked is whether the host's control plane answers.
 *   It only runs while the party runs, which makes it a fair stand-in
 *   for "the world is up, you can join" — but it says nothing about
 *   Minecraft itself, and the UI must not pretend otherwise.
 */
export interface PartyStatus {
  state: "online" | "offline";
  /** Which probe answered — how much the rest of this can be trusted. */
  via: "minecraft" | "control-plane";
  /** Round trip in milliseconds, or null when nothing answered. */
  pingMs: number | null;
  /** Minecraft version string, when a full ping got through. */
  version: string | null;
  players: { online: number; max: number } | null;
  motd: string | null;
  /** Why it's offline, in the words we'd show a person. */
  detail: string | null;
  checkedAt: string;
}

function offline(via: PartyStatus["via"], detail: string): PartyStatus {
  return {
    state: "offline",
    via,
    pingMs: null,
    version: null,
    players: null,
    motd: null,
    detail,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Full server-list ping. `host`/`port` are the joiner's local proxy
 * (127.0.0.1:localPort) — the tailnet hop is inside the measured time,
 * which is exactly the latency the player will feel.
 */
export async function pingMinecraft(
  host: string,
  port: number,
  timeoutMs = 8000,
): Promise<PartyStatus> {
  const started = Date.now();
  let socket: net.Socket | null = null;
  try {
    socket = await connect(host, port, timeoutMs);
    const status = await minecraftStatus(socket, host, port, timeoutMs);
    const online = status.players?.online;
    const max = status.players?.max;
    const motd = motdText(status.description);
    return {
      state: "online",
      via: "minecraft",
      pingMs: Date.now() - started,
      version: status.version?.name ?? null,
      players:
        typeof online === "number" && typeof max === "number"
          ? { online, max }
          : null,
      motd: motd || null,
      detail: null,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return offline(
      "minecraft",
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    socket?.destroy();
  }
}

/**
 * Liveness of the host's control plane — the headscale that hands out
 * the tailnet, which exists only while the party is running. /health is
 * the endpoint headscale serves for exactly this.
 */
export async function pingControlPlane(
  controlPlaneUrl: string,
  timeoutMs = 6000,
): Promise<PartyStatus> {
  const started = Date.now();
  try {
    const res = await fetch(new URL("/health", controlPlaneUrl), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Drain it: an unread body keeps the socket alive for the timeout.
    await res.arrayBuffer().catch(() => {});
    if (!res.ok) {
      return offline("control-plane", `The host answered HTTP ${res.status}.`);
    }
    return {
      state: "online",
      via: "control-plane",
      pingMs: Date.now() - started,
      version: null,
      players: null,
      motd: null,
      detail: null,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return offline(
      "control-plane",
      timedOut ? "The host didn't answer in time." : "Couldn't reach the host.",
    );
  }
}

function connect(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Connection timed out"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    });
  });
}
