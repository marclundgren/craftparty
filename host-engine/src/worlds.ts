import fsp from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./platform.ts";

/**
 * A world is a directory under <dataDir>/worlds/<id> holding the Minecraft
 * save, server.properties and mods. Worlds outlive the party that created
 * them: stopping a party (or quitting the app) shuts the server down
 * cleanly and leaves the directory in place, so the same world can be
 * hosted again later. Nothing here ever deletes a world implicitly —
 * removal is always an explicit deleteWorld() call from the host.
 */
const META_FILE = "craftparty-world.json";

export interface WorldMeta {
  v: 1;
  /** What the host typed; shown in the UI and used for the MOTD. */
  name: string;
  createdAt: string;
  lastPlayedAt: string | null;
  /** Addons chosen the last time this world was hosted. */
  addonIds: string[];
}

export interface World extends WorldMeta {
  /** Directory name — stable, path- and hostname-safe. */
  id: string;
  dir: string;
}

export interface WorldSummary extends World {
  /** Total bytes on disk; best effort, 0 if the walk fails. */
  sizeBytes: number;
}

export function worldsDir(): string {
  return path.join(dataDir(), "worlds");
}

/**
 * Directory name for a display name. Lossy on purpose — "Dragon Cave!"
 * and "dragon cave" are the same world, which is why creating a world
 * checks for an existing id rather than trusting the display name.
 */
export function worldId(name: string): string {
  const clean = name
    .trim()
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, "-");
  if (!clean) {
    throw new Error(`World name ${JSON.stringify(name)} is not usable`);
  }
  return clean.toLowerCase();
}

/** Reject ids that aren't ours before they reach the filesystem. */
function worldDirFor(id: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
    throw new Error(`Not a valid world id: ${JSON.stringify(id)}`);
  }
  const dir = path.join(worldsDir(), id);
  if (path.dirname(dir) !== worldsDir()) {
    throw new Error(`Not a valid world id: ${JSON.stringify(id)}`);
  }
  return dir;
}

async function readMeta(id: string, dir: string): Promise<WorldMeta> {
  try {
    const meta = JSON.parse(
      await fsp.readFile(path.join(dir, META_FILE), "utf8"),
    ) as WorldMeta;
    return {
      v: 1,
      name: meta.name || id,
      createdAt: meta.createdAt ?? new Date(0).toISOString(),
      lastPlayedAt: meta.lastPlayedAt ?? null,
      addonIds: Array.isArray(meta.addonIds) ? meta.addonIds : [],
    };
  } catch {
    // A world from before metadata existed (or an unreadable file):
    // reconstruct what we can from the directory itself. Mtime is a
    // decent stand-in for "last played" — the server writes as it runs.
    const stat = await fsp.stat(dir);
    return {
      v: 1,
      name: id,
      createdAt: stat.birthtime.toISOString(),
      lastPlayedAt: stat.mtime.toISOString(),
      addonIds: [],
    };
  }
}

async function writeMeta(dir: string, meta: WorldMeta): Promise<void> {
  await fsp.writeFile(
    path.join(dir, META_FILE),
    JSON.stringify(meta, null, 2) + "\n",
  );
}

/** Every saved world, most recently played first. */
export async function listWorlds(): Promise<WorldSummary[]> {
  let entries;
  try {
    entries = await fsp.readdir(worldsDir(), { withFileTypes: true });
  } catch {
    return []; // no worlds yet
  }
  const worlds: WorldSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let dir: string;
    try {
      dir = worldDirFor(entry.name);
    } catch {
      continue; // stray directory we didn't create
    }
    const meta = await readMeta(entry.name, dir);
    worlds.push({ ...meta, id: entry.name, dir, sizeBytes: await dirSize(dir) });
  }
  return worlds.sort(
    (a, b) =>
      Date.parse(b.lastPlayedAt ?? b.createdAt) -
      Date.parse(a.lastPlayedAt ?? a.createdAt),
  );
}

export async function getWorld(id: string): Promise<World> {
  const dir = worldDirFor(id);
  try {
    await fsp.access(dir);
  } catch {
    throw new Error(`That world is gone — it may have been deleted.`);
  }
  return { ...(await readMeta(id, dir)), id, dir };
}

export async function worldExists(id: string): Promise<boolean> {
  try {
    await fsp.access(worldDirFor(id));
    return true;
  } catch {
    return false;
  }
}

/** Create a brand-new world. Refuses to reuse an existing one. */
export async function createWorld(name: string): Promise<World> {
  const id = worldId(name);
  if (await worldExists(id)) {
    throw new Error(
      `You already have a world called "${name}" — pick it from your worlds to keep playing it, or choose a different name.`,
    );
  }
  const dir = worldDirFor(id);
  await fsp.mkdir(dir, { recursive: true });
  const meta: WorldMeta = {
    v: 1,
    name: name.trim(),
    createdAt: new Date().toISOString(),
    lastPlayedAt: null,
    addonIds: [],
  };
  await writeMeta(dir, meta);
  return { ...meta, id, dir };
}

/** Resume the world with this name, creating it if it's new. */
export async function ensureWorld(name: string): Promise<World> {
  const id = worldId(name);
  return (await worldExists(id)) ? getWorld(id) : createWorld(name);
}

/** Stamp a world as played now, remembering the addons it ran with. */
export async function recordPlayed(
  id: string,
  addonIds: string[],
): Promise<void> {
  const world = await getWorld(id);
  await writeMeta(world.dir, {
    v: 1,
    name: world.name,
    createdAt: world.createdAt,
    lastPlayedAt: new Date().toISOString(),
    addonIds,
  });
}

/** Permanently remove a world and everything in it. */
export async function deleteWorld(id: string): Promise<void> {
  const dir = worldDirFor(id);
  await fsp.rm(dir, { recursive: true, force: true });
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(p);
    } else if (entry.isFile()) {
      try {
        total += (await fsp.stat(p)).size;
      } catch {
        // vanished mid-walk (the server is writing) — skip it
      }
    }
  }
  return total;
}
