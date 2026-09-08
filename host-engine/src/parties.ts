import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./platform.ts";
import { decodeInvite, type Invite } from "./party.ts";

/**
 * The parties this computer has joined, remembered at
 * <dataDir>/parties.json. A saved party outlives the connection to it:
 * the invite code is kept so the same world can be rejoined later, and
 * so the list can say whether the host is up right now (see
 * party-status.ts) without the friend having to dig the invite out of a
 * chat again.
 *
 * Nothing is ever dropped implicitly — an entry goes away only when the
 * friend forgets it.
 */
const FILE = "parties.json";

export interface JoinedParty {
  /** Stable, derived from the invite — see partyId(). */
  id: string;
  /** The host's name for the world; what the friend recognises it by. */
  name: string;
  /** The invite this entry was last saved from; rejoining replays it. */
  inviteCode: string;
  controlPlaneUrl: string;
  /** The host's Minecraft server inside the tailnet. */
  host: string;
  port: number;
  /**
   * The Minecraft version the host runs, from the invite — which client
   * to launch. null for an invite from before hosts sent it; a live ping
   * fills that gap once connected (see party-status.ts).
   */
  minecraftVersion: string | null;
  addedAt: string;
  lastJoinedAt: string | null;
}

const partiesFile = () => path.join(dataDir(), FILE);

/**
 * Identity for a party: its name plus a fingerprint of where it lives.
 * The name alone would let two friends' "Survival" worlds overwrite each
 * other; the fingerprint alone would be unreadable in the file. Both
 * halves are stable across a host stopping and restarting the same world
 * — headscale keeps its database per world, so the tailnet address comes
 * back the same — which is what makes rejoining update an entry instead
 * of piling up duplicates. A host whose public IP changes does get a
 * second entry; that is what "Forget" is for.
 */
export function partyId(invite: Invite): string {
  const slug =
    invite.party
      .trim()
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase() || "party";
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${invite.controlPlaneUrl}|${invite.server.host}:${invite.server.port}`)
    .digest("hex")
    .slice(0, 6);
  return `${slug}-${fingerprint}`;
}

/** Only entries we could actually act on survive — the file is editable. */
function sanitize(raw: unknown): JoinedParty | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<JoinedParty>;
  if (
    typeof p.id !== "string" ||
    typeof p.name !== "string" ||
    typeof p.inviteCode !== "string" ||
    typeof p.controlPlaneUrl !== "string" ||
    typeof p.host !== "string" ||
    typeof p.port !== "number"
  ) {
    return null;
  }
  return {
    id: p.id,
    name: p.name,
    inviteCode: p.inviteCode,
    controlPlaneUrl: p.controlPlaneUrl,
    host: p.host,
    port: p.port,
    minecraftVersion:
      typeof p.minecraftVersion === "string" ? p.minecraftVersion : null,
    addedAt: typeof p.addedAt === "string" ? p.addedAt : new Date(0).toISOString(),
    lastJoinedAt: typeof p.lastJoinedAt === "string" ? p.lastJoinedAt : null,
  };
}

async function readAll(): Promise<JoinedParty[]> {
  try {
    const raw = JSON.parse(await fsp.readFile(partiesFile(), "utf8")) as {
      parties?: unknown[];
    };
    if (!Array.isArray(raw?.parties)) return [];
    return raw.parties
      .map(sanitize)
      .filter((p): p is JoinedParty => p !== null);
  } catch {
    return []; // no file yet, or one we can't read — the same thing here
  }
}

async function writeAll(parties: JoinedParty[]): Promise<void> {
  await fsp.mkdir(dataDir(), { recursive: true });
  await fsp.writeFile(
    partiesFile(),
    JSON.stringify({ v: 1, parties }, null, 2) + "\n",
  );
}

// Every mutation is a read-modify-write of one small file, and several
// can be in flight at once (joining while a status refresh records a
// rejoin). Queue them so the last writer can't erase the previous one.
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

/** Every remembered party, most recently joined first. */
export async function listParties(): Promise<JoinedParty[]> {
  const parties = await readAll();
  return parties.sort(
    (a, b) =>
      Date.parse(b.lastJoinedAt ?? b.addedAt) -
      Date.parse(a.lastJoinedAt ?? a.addedAt),
  );
}

export async function getParty(id: string): Promise<JoinedParty> {
  const party = (await readAll()).find((p) => p.id === id);
  if (!party) throw new Error("That party isn't in your list any more.");
  return party;
}

/**
 * Remember a party from its invite, or refresh the one already saved
 * under the same id with this newer invite — a host who restarts mints a
 * fresh auth key, and the stored code has to keep up or rejoining later
 * fails.
 */
export async function rememberParty(
  inviteCode: string,
): Promise<JoinedParty> {
  const code = inviteCode.trim();
  const invite = decodeInvite(code);
  const id = partyId(invite);
  return serialize(async () => {
    const parties = await readAll();
    const existing = parties.find((p) => p.id === id);
    const party: JoinedParty = {
      id,
      name: invite.party,
      inviteCode: code,
      controlPlaneUrl: invite.controlPlaneUrl,
      host: invite.server.host,
      port: invite.server.port,
      // A host who upgrades their world sends a new invite saying so;
      // an older invite without the field leaves what we already knew.
      minecraftVersion: invite.minecraft ?? existing?.minecraftVersion ?? null,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
      lastJoinedAt: existing?.lastJoinedAt ?? null,
    };
    await writeAll([party, ...parties.filter((p) => p.id !== id)]);
    return party;
  });
}

/** Stamp a party as joined now, so the list stays in the order used. */
export function recordJoined(id: string): Promise<void> {
  return serialize(async () => {
    const parties = await readAll();
    const party = parties.find((p) => p.id === id);
    if (!party) return;
    party.lastJoinedAt = new Date().toISOString();
    await writeAll(parties);
  });
}

/** Drop a party from the list. Nothing on this computer is deleted. */
export function forgetParty(id: string): Promise<boolean> {
  return serialize(async () => {
    const parties = await readAll();
    const kept = parties.filter((p) => p.id !== id);
    if (kept.length === parties.length) return false;
    await writeAll(kept);
    return true;
  });
}
